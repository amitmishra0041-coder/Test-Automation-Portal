@echo off
REM ==============================================================================
REM PDF Comparison Test Runner
REM ==============================================================================
REM This script runs the PDF comparison test with two specified PDFs
REM Usage: run-pdf-comparison.bat "path\to\pdf1.pdf" "path\to\pdf2.pdf"
REM ==============================================================================

cd /d "%~dp0"

echo.
echo ================================================================================
echo PDF COMPARISON TEST
echo ================================================================================
echo.

REM Check if paths provided as arguments
if "%~1"=="" (
    echo Using default PDF paths from test file...
    echo.
    npx playwright test Compare_PDFs.test.js --headed
) else if "%~2"=="" (
    echo ERROR: Please provide both PDF paths
    echo Usage: run-pdf-comparison.bat "path\to\pdf1.pdf" "path\to\pdf2.pdf"
    exit /b 1
) else (
    echo PDF 1: %~1
    echo PDF 2: %~2
    echo.
    set "PDF1_PATH=%~1"
    set "PDF2_PATH=%~2"
    npx playwright test Compare_PDFs.test.js --headed
)

echo.
echo ================================================================================
echo TEST COMPLETED - Check test-results\pdf-comparison\ for reports
echo ================================================================================
echo.
pause
