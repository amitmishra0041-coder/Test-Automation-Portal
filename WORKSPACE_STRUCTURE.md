# Workspace Organization Guide

## Folder Structure

```
Test-Automation-Portal/
├── config/                          # Configuration & environment settings
│   ├── playwright.config.js         # Playwright test configuration
│   ├── stateConfig.js              # State-specific configurations
│   ├── testEnv.js                  # Environment utilities
│   └── .env                         # SMTP & environment variables
│
├── runners/                         # Test execution scripts
│   ├── run-bop-test.bat           # BOP test runner (batch)
│   ├── run-package-test.bat       # Package test runner (batch)
│   ├── run-parallel-bop.ps1       # BOP parallel executor (PowerShell)
│   ├── run-parallel-package.ps1   # Package parallel executor
│   ├── run-account-test.bat       # Account creation runner
│   ├── run-ca-test.bat            # CA test runner
│   ├── run-bop-then-package.bat   # Combined BOP → Package runner
│   ├── run-all-tests.bat          # Run both suites
│   ├── run-pdf-comparison.bat     # PDF comparison tests
│   └── RUN_ALL_TESTS.bat          # Alternative run all
│
├── reporters/                       # Test reporting & cleanup
│   ├── emailReporter.js            # Email report generator
│   ├── stepLogger.js               # Step logging utilities
│   └── clean-artifacts.ps1         # One-click cleanup script
│
├── tests/                          # Test files
│   ├── Create_BOP.test.js         # Businessowners test
│   ├── Create_Package.test.js     # Commercial Package test
│   ├── Create_Account.test.js     # Account creation test
│   ├── Create_CA.test.js          # CA test
│   ├── Clear_Account_Summ.test.js # Account summary test
│   └── Compare_PDFs.test.js       # PDF comparison test
│
├── helpers/                        # Test helpers & utilities
│   ├── SFA_SFI_Workflow.js        # Policy submission workflow
│   ├── SFA_SFI_Workflow_simplified.js
│   ├── envConfig.js               # Environment config helper
│   ├── clickGuidewireText.js      # Click helper
│   ├── EmailReporter.js           # (legacy, see reporters/)
│   └── randomData.js              # Faker-based random data generators
│
├── utils/                          # General utilities
│   ├── blinqClick.js              # Blinq click utility
│   └── gwClickHelper.js           # Guidewire click helper
│
├── data/                          # Test data & outputs (ephemeral)
│   ├── quoteNumbers.txt           # Generated quote numbers
│   ├── test-data.json             # Current test data
│   ├── iterations-data-bop.json   # BOP run iterations
│   ├── iterations-data-package.json # Package run iterations
│   └── performance_metrics.txt    # Performance data
│
├── output/                        # Test results & artifacts
│   ├── test-results/              # Playwright test results
│   ├── trace-unzip/               # Unzipped trace files
│   ├── test-run-output-*.txt      # Per-state test logs
│   └── WB_Test_Report_*.xlsx      # Generated Excel reports
│
├── docs/                          # Documentation
│   ├── README.md                  # Project overview
│   ├── commands-cheatsheet.md     # Command reference
│   └── PARALLEL_TESTING.md        # Parallel execution guide
│
├── test-data/                     # Test data folder (existing)
│   └── (custom test data if any)
│
├── .vscode/                       # VS Code settings
├── node_modules/                  # Dependencies
├── accountCreationHelper.js       # Account creation helper (root level)
├── package.json                   # Dependencies manifest
├── package-lock.json              # Locked dependencies
├── .gitignore                     # Git ignore rules
└── .git/                          # Git repository
```

## File Organization by Purpose

### Configuration Files (`config/`)
- **playwright.config.js**: Playwright framework configuration (timeouts, reporters, projects)
- **stateConfig.js**: State-specific test data and configurations (DE, MI, OH, PA, WI)
- **testEnv.js**: Environment-specific URLs and utilities
- **.env**: SMTP settings, credentials, and environment variables

### Test Runners (`runners/`)
- **Batch Scripts** (.bat): Windows batch file runners for easy GUI access
  - `run-bop-test.bat`: Run BOP tests for a single state
  - `run-package-test.bat`: Run Package tests for a single state
  - `run-all-tests.bat`: Run both suites in parallel
- **PowerShell Scripts** (.ps1): Advanced parallel executors
  - `run-parallel-bop.ps1`: Run BOP across multiple states in parallel
  - `run-parallel-package.ps1`: Run Package across multiple states in parallel
  - Support `-KillStrays`, `-Headed`, `-TestEnv`, `-States` flags

### Reporters (`reporters/`)
- **emailReporter.js**: Generates and sends batch email reports with Excel attachments
- **stepLogger.js**: Logs individual test steps and milestones
- **clean-artifacts.ps1**: One-click cleanup of logs, iterations, traces, test data

### Tests (`tests/`)
- **Create_BOP.test.js**: Businessowners policy submission test
- **Create_Package.test.js**: Commercial Package policy submission test
- **Create_Account.test.js**: Account creation and qualification test
- Other test files for specialized workflows

### Helpers (`helpers/`)
- **SFA_SFI_Workflow.js**: Policy submission workflow automation
- **envConfig.js**: Multi-environment configuration handler
- **clickGuidewireText.js**: Custom click handler for Guidewire elements

### Data Files (`data/`)
- **test-data.json**: Current test execution data (generated per run)
- **quoteNumbers.txt**: Quote numbers extracted from test runs
- **iterations-data-*.json**: Test results grouped by suite and state
- **performance_metrics.txt**: Performance tracking data

### Output Files (`output/`)
- **test-results/**: Playwright JSON reports
- **trace-unzip/**: Browser trace artifacts for debugging
- **test-run-output-*.txt**: Per-state test logs
- **WB_Test_Report_*.xlsx**: Excel reports with test results and milestones

### Documentation (`docs/`)
- **README.md**: Project overview and setup
- **commands-cheatsheet.md**: Quick command reference
- **PARALLEL_TESTING.md**: Guide to parallel test execution

## Quick Start Commands

### Run Tests
```powershell
# BOP single state (headed)
.\runners\run-bop-test.bat qa DE

# Package all states in parallel
powershell.exe -ExecutionPolicy Bypass -File ".\runners\run-parallel-package.ps1" -TestEnv qa -States "DE,PA,WI,OH,MI" -Project chromium -Headed

# Both suites in parallel
.\runners\run-all-tests.bat qa
```

### Cleanup
```powershell
# One-click cleanup
powershell.exe -ExecutionPolicy Bypass -File ".\reporters\clean-artifacts.ps1" -DryRun

# Dry run first to preview
powershell.exe -ExecutionPolicy Bypass -File ".\reporters\clean-artifacts.ps1"
```

### View Reports
```powershell
# Check latest Excel report
Start-Process ".\output\WB_Test_Report_*.xlsx"

# View test results
Get-ChildItem ".\output\test-results\" | Select-Object Name
```

## Notes

- **Ephemeral Data**: Files in `data/` are generated during test runs; delete freely with cleanup script
- **Artifacts**: `output/` contains test results; archive before running cleanup
- **Configuration**: Update `config/.env` with SMTP credentials for email reports
- **State Configs**: Add/modify states in `config/stateConfig.js` to support new regions

