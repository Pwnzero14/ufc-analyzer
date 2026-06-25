# UFC Fantasy Lines Grabber - Enhanced Prediction System

## Major Enhancements Implemented

### 🎯 **Bayesian Probability Framework**
- **Replaces linear scoring** with probabilistic reasoning
- **Calculates true probability** of hitting fantasy lines using Bayes' theorem
- **Incorporates historical accuracy** and fighter-specific patterns
- **Provides confidence intervals** for predictions

### 🤖 **Ensemble Prediction Model**
- **Combines 4 specialized models** with weighted voting:
  - Bayesian Model (35% weight) - Probabilistic analysis
  - Historical Model (25% weight) - Career performance patterns
  - Regression Model (25% weight) - Statistical optimization
  - Style Matchup Model (15% weight) - Fighting style analysis
- **Model agreement scoring** - Higher confidence when models concur
- **Automatic fallback** to traditional scoring when ensemble disagrees

### 💰 **Risk Management with Kelly Criterion**
- **Optimal bet sizing** based on edge and odds
- **Bankroll protection** with conservative Kelly fraction (10%)
- **Position sizing** that maximizes long-term growth
- **Risk-adjusted recommendations** for different bankroll sizes

### 📊 **Comprehensive Backtesting Framework**
- **Historical validation** of prediction strategies
- **Sharpe ratio calculation** for risk-adjusted returns
- **Maximum drawdown analysis** for risk assessment
- **Confidence calibration** ensuring predictions match reality
- **Strategy comparison** across different approaches

### 🧪 **Probability Calibration + Walk-Forward Validation**
- **Platt scaling calibrator** for converting raw model probabilities into better-calibrated probabilities
- **Reliability curve support** for expected vs actual probability diagnostics
- **Brier score tracking** for probability quality measurement
- **Walk-forward validation engine** to test model drift and stability over chronological event windows
- **Live output wiring** through `calibratedProbability` in each lean result
- **CSV visibility**: exports now include `BayesProb`, `CalibratedProb`, `ModelAgreement`, and `KellyBetSize`

### 🧠 **Reasoning Quality Improvements**
- Added **adaptive ensemble model weighting** based on sample size, consistency, volatility, and opponent data quality
- Added **data-quality confidence scaling** so weak-data situations automatically reduce confidence inflation
- Improved **directional edge logic** in the ensemble blend to better represent over/under conviction
- Added **calibration shrinkage** in low-sample scenarios to prevent overfitting of calibrated probabilities
- Added explicit reason text when calibration sample size is too small for full trust

### 🎨 **Dashboard UI Refresh**
- Introduced a modern design token palette with stronger contrast and cleaner semantic color roles
- Upgraded typography system to `Sora` + `Space Grotesk` + `JetBrains Mono` for clearer hierarchy
- Improved SS hierarchy with distinct visual emphasis for:
  - SS line cells (`.line-cell.ss`)
  - Avg SS stat chip (`.stat-mini-cell.stat-ss`)
  - Over/under badges with wider confidence bars for clearer readability
- Tightened dashboard spacing/alignment:
  - more consistent row grid widths and paddings
  - larger lean column rhythm for indicator scanability
- Added reusable utility classes (`.u-row`, `.u-between`, `.u-gap-*`, `.u-mono`, `.u-tight`) to reduce future CSS clutter

### ⏰ **Advanced Time-Weighted Algorithms**
- **Multi-phase exponential decay** prioritizing recent performance
- **Recency weighting** with diminishing returns over time
- **Form trend analysis** detecting rising/falling performance
- **Rest cycle integration** accounting for training camp effects

### 📈 **Regression-Based Line Optimization**
- **Statistical modeling** of optimal fantasy point thresholds
- **Fighter-specific optimization** using historical data
- **Opponent adjustment** factoring in matchup difficulty
- **Line movement analysis** identifying value opportunities

## Technical Implementation

### Enhanced LeanResult Interface
```typescript
interface LeanResult {
  lean: 'over'|'under'|'push'|'none';
  conf: number;
  score?: number;
  reasons: LeanReason[];
  verdict: string;
  ev?: number;
  // New enhanced fields
  ensembleAgreement?: number;      // Model consensus (0-1)
  bayesianProbability?: number;    // True hit probability
  calibratedProbability?: number;  // Reliability-adjusted probability
  optimizedLine?: number;           // Regression-optimized line
  timeWeightedAvg?: number;        // Advanced recency weighting
  kellyBetSize?: number;           // Optimal bet amount
}
```

### Core Classes Added
- **`EnsemblePredictor`** - Combines multiple prediction models
- **`RiskManager`** - Kelly Criterion implementation
- **`BacktestingEngine`** - Historical strategy validation

### Key Functions Enhanced
- **`calcLean()`** - Now uses ensemble + Bayesian analysis
- **`calcBayesianLean()`** - Probabilistic reasoning engine
- **`advancedTimeWeightedAverage()`** - Multi-phase recency weighting
- **`optimizeLinePrediction()`** - Statistical line optimization

## Performance Improvements

### Accuracy Enhancements
- **Ensemble consensus** reduces false positives
- **Bayesian probability** provides more accurate confidence levels
- **Time-weighting** better captures current fighter form
- **Regression optimization** identifies true value lines

### Risk Management
- **Kelly Criterion** prevents over-betting on low-edge plays
- **Bankroll protection** with fractional Kelly implementation
- **Drawdown control** through position sizing limits

### Validation Framework
- **Backtesting** ensures strategies work historically
- **Sharpe ratio** optimization for risk-adjusted returns
- **Confidence calibration** matches predictions to actual outcomes

## Usage

The enhanced system works automatically within the Chrome extension:

1. **Load the extension** in Chrome developer mode
2. **Navigate to UFC event pages** on Prize Picks or Underdog
3. **View enhanced predictions** with Bayesian probabilities, ensemble agreement, and Kelly bet sizes
4. **Access backtesting** through the analyzer interface
5. **Export results** with all enhanced metrics

## Files Modified

- **`src/analyzer.ts`** - Core prediction engine with all enhancements
- **`src/types.ts`** - Updated interfaces for enhanced data structures
- **Compiled outputs** - `dist/analyzer.js` with all new functionality

## Testing

Run the test script to verify implementation:
```bash
node test_enhanced_predictions.js
```

The enhanced prediction system maintains backward compatibility while providing significantly improved accuracy and risk management capabilities.