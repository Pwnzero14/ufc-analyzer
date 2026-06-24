param(
  [ValidateSet('save', 'resume')]
  [string]$Mode = 'save',

  [string]$Notes = '',

  [switch]$CreateSnapshot
)

$ErrorActionPreference = 'Stop'

$repoRoot = $PSScriptRoot
$checkpointDir = Join-Path $repoRoot '.checkpoint'
$statePath = Join-Path $checkpointDir 'resume-state.json'
$checkpointMarkdownPath = Join-Path $repoRoot 'RESUME_CHECKPOINT.md'

function New-ProjectSnapshot {
  $timestamp = Get-Date -Format 'yyyyMMdd_HHmmss'
  $backupsDir = Join-Path $repoRoot 'backups'
  if (-not (Test-Path $backupsDir)) {
    New-Item -ItemType Directory -Path $backupsDir -Force | Out-Null
  }

  $snapshotDir = Join-Path $backupsDir ("full_project_snapshot_" + $timestamp)
  New-Item -ItemType Directory -Path $snapshotDir -Force | Out-Null

  & robocopy $repoRoot $snapshotDir /E /XD backups /NFL /NDL /NJH /NJS /NP /R:1 /W:1 | Out-Null

  $zipPath = "$snapshotDir.zip"
  if (Test-Path $zipPath) {
    Remove-Item $zipPath -Force
  }

  # Zip format cannot represent timestamps before 1980-01-01.
  # Some copied files can carry old/invalid times, so normalize before compression.
  $zipMinDate = Get-Date '1980-01-01T00:00:00Z'
  Get-ChildItem -Path $snapshotDir -Recurse -Force -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -lt $zipMinDate } |
    ForEach-Object { $_.LastWriteTime = $zipMinDate }

  $zipCreated = $true
  try {
    Compress-Archive -Path (Join-Path $snapshotDir '*') -DestinationPath $zipPath -CompressionLevel Optimal
  }
  catch {
    $zipCreated = $false
    Write-Warning ('Snapshot zip creation failed; directory snapshot is still available. Error: ' + $_.Exception.Message)
  }

  $restoreScript = @"
param([string]`$SnapshotDir)
if (-not `$SnapshotDir) { Write-Error 'Usage: .\restore-project.ps1 -SnapshotDir <path>'; exit 1 }
robocopy `$SnapshotDir . /E /NFL /NDL /NJH /NJS /NP /R:1 /W:1 | Out-Null
Write-Output ('Restored full project from ' + `$SnapshotDir)
"@
  Set-Content -Path (Join-Path $snapshotDir 'restore-project.ps1') -Value $restoreScript -Encoding UTF8

  return [ordered]@{
    snapshotDir = $snapshotDir
    snapshotZip = if ($zipCreated) { $zipPath } else { $null }
  }
}

function Get-GitText {
  param([string[]]$GitArgs)

  try {
    return ((& git -C $repoRoot @GitArgs 2>$null) | Out-String).Trim()
  }
  catch {
    return ''
  }
}

function Get-GitLines {
  param([string[]]$GitArgs)

  try {
    $result = & git -C $repoRoot @GitArgs 2>$null
    if ($null -eq $result) { return @() }
    if ($result -is [System.Array]) { return $result }
    return @($result)
  }
  catch {
    return @()
  }
}

if (-not (Test-Path $checkpointDir)) {
  New-Item -ItemType Directory -Path $checkpointDir -Force | Out-Null
}

if ($Mode -eq 'save') {
  $savedAt = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss zzz')
  $branch = Get-GitText -GitArgs @('rev-parse', '--abbrev-ref', 'HEAD')
  $head = Get-GitText -GitArgs @('rev-parse', '--short', 'HEAD')
  $statusLines = Get-GitLines -GitArgs @('status', '--short')
  $diffStatLines = Get-GitLines -GitArgs @('diff', '--stat')

  $snapshot = $null
  if ($CreateSnapshot) {
    $snapshot = New-ProjectSnapshot
  }

  $changedFiles = @()
  foreach ($line in $statusLines) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    if ($line.Length -ge 4) {
      $changedFiles += $line.Substring(3).Trim()
    }
    else {
      $changedFiles += $line.Trim()
    }
  }

  $state = [ordered]@{
    savedAt = $savedAt
    repoRoot = $repoRoot
    branch = if ($branch) { $branch } else { 'unknown' }
    head = if ($head) { $head } else { 'unknown' }
    notes = $Notes
    buildCommand = 'npm run build'
    status = $statusLines
    changedFiles = $changedFiles
    diffStat = $diffStatLines
    snapshotDir = if ($snapshot) { $snapshot.snapshotDir } else { $null }
    snapshotZip = if ($snapshot) { $snapshot.snapshotZip } else { $null }
    resumeChecklist = @(
      'Run npm run build to confirm TypeScript is clean.',
      'Open RESUME_CHECKPOINT.md and continue from Last Notes + Resume Checklist.',
      'If needed, run git status to verify working tree before new edits.'
    )
  }

  $state | ConvertTo-Json -Depth 8 | Set-Content -Path $statePath -Encoding UTF8

  $statusBlock = if ($statusLines.Count -gt 0) { ($statusLines -join "`n") } else { '(clean working tree)' }
  $diffStatBlock = if ($diffStatLines.Count -gt 0) { ($diffStatLines -join "`n") } else { '(no unstaged diff)' }
  $notesBlock = if ([string]::IsNullOrWhiteSpace($Notes)) { '(none)' } else { $Notes }
  $snapshotSection = if ($snapshot) {
@"
## Snapshot
Directory: $($snapshot.snapshotDir)
Zip: $($snapshot.snapshotZip)

"@
  } else { '' }

  $md = @"
# Resume Checkpoint

Last Saved: $savedAt
Repository: $repoRoot
Branch: $($state.branch)
HEAD: $($state.head)

## Last Notes
$notesBlock

$snapshotSection## Resume Checklist
1. Run npm run build.
2. Check git status.
3. Continue the highest-priority task from your notes.

## Working Tree Status
~~~text
$statusBlock
~~~

## Diff Summary
~~~text
$diffStatBlock
~~~

## Quick Commands
~~~powershell
npm run checkpoint:resume
npm run build
git status
~~~
"@

  Set-Content -Path $checkpointMarkdownPath -Value $md -Encoding UTF8

  Write-Output "Checkpoint saved."
  if ($snapshot) {
    Write-Output ("Snapshot directory: " + $snapshot.snapshotDir)
    Write-Output ("Snapshot zip: " + $snapshot.snapshotZip)
  }
  Write-Output "State file: $statePath"
  Write-Output "Summary file: $checkpointMarkdownPath"
  exit 0
}

if (-not (Test-Path $statePath)) {
  Write-Error "No checkpoint found. Run: npm run checkpoint:save -- -Notes 'what you were doing'"
  exit 1
}

$resumeState = Get-Content -Path $statePath -Raw | ConvertFrom-Json

Write-Output ''
Write-Output '=== Resume Brief ==='
Write-Output ("Saved At : {0}" -f $resumeState.savedAt)
Write-Output ("Branch   : {0}" -f $resumeState.branch)
Write-Output ("HEAD     : {0}" -f $resumeState.head)
Write-Output ("Notes    : {0}" -f ($(if ([string]::IsNullOrWhiteSpace($resumeState.notes)) { '(none)' } else { $resumeState.notes })))
if ($resumeState.snapshotZip) {
  Write-Output ("Snapshot : {0}" -f $resumeState.snapshotZip)
}
Write-Output ''
Write-Output 'Changed Files:'
if ($resumeState.changedFiles -and $resumeState.changedFiles.Count -gt 0) {
  $resumeState.changedFiles | ForEach-Object { Write-Output (" - {0}" -f $_) }
}
else {
  Write-Output ' - (none)'
}
Write-Output ''
Write-Output 'Next Commands:'
Write-Output ' - npm run build'
Write-Output ' - git status'
Write-Output ' - Open RESUME_CHECKPOINT.md'
