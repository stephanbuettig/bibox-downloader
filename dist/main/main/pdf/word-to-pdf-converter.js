"use strict";
// ============================================================================
// BiBox Downloader — Word DOC/DOCX → PDF Converter
// ============================================================================
// Converts Word documents to PDF using Microsoft Word COM automation via
// PowerShell. This is the same mechanism that Python's docx2pdf uses
// internally, but without requiring Python to be installed.
//
// Strategy:
//   1. MS Word COM via PowerShell (best quality — Word does the rendering)
//      Works on any Windows system with Microsoft Word installed.
//      PowerShell is built into every Windows version since Windows 7.
//
//   2. If Word is not installed → returns empty map, caller falls back
//      to text extraction via pdf-lib.
//
// IMPORTANT: The PowerShell script is written to a temp .ps1 file with
// UTF-8 BOM encoding, then executed via -File. This is critical for
// proper handling of paths containing German umlauts (ä, ö, ü, ß).
// Passing the script inline via -Command mangles Unicode characters.
//
// Batch processing: Converts files sequentially via a single PowerShell
// session that keeps Word.Application COM open between files for speed.
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.isWordAvailable = isWordAvailable;
exports.convertAllDocsViaWord = convertAllDocsViaWord;
const child_process_1 = require("child_process");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const logger_1 = require("../logging/logger");
/** Cached result of Word availability check */
let wordAvailable;
/**
 * Check if Microsoft Word is available via COM automation.
 * Tests by creating a Word.Application object in PowerShell.
 */
async function isWordAvailable() {
    if (wordAvailable !== undefined)
        return wordAvailable;
    if (process.platform !== 'win32') {
        logger_1.logger.info('WordPDF', 'Not on Windows — Word COM not available');
        wordAvailable = false;
        return false;
    }
    return new Promise((resolve) => {
        // Quick test: try to create Word.Application COM object
        const testScript = `
      try {
        $word = New-Object -ComObject Word.Application
        $word.Quit()
        [System.Runtime.Interopservices.Marshal]::ReleaseComObject($word) | Out-Null
        Write-Output "WORD_OK"
      } catch {
        Write-Output "WORD_NOT_FOUND"
      }
    `;
        (0, child_process_1.execFile)('powershell.exe', [
            '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
            '-Command', testScript,
        ], { timeout: 30_000 }, (error, stdout) => {
            if (error || !stdout.includes('WORD_OK')) {
                logger_1.logger.warn('WordPDF', 'Microsoft Word NOT found on this system');
                wordAvailable = false;
                resolve(false);
            }
            else {
                logger_1.logger.info('WordPDF', 'Microsoft Word found — COM automation available');
                wordAvailable = true;
                resolve(true);
            }
        });
    });
}
/**
 * Convert all DOC/DOCX files to PDF using Microsoft Word via PowerShell.
 *
 * Opens a SINGLE Word.Application instance, converts all files sequentially,
 * then closes Word. This is much faster than opening/closing Word per file.
 *
 * The script is saved to a temp .ps1 file with UTF-8 BOM encoding to ensure
 * paths with German umlauts (ä, ö, ü, ß) are handled correctly.
 *
 * @returns Map<inputPath, outputPdfPath> for successful conversions
 */
async function convertAllDocsViaWord(files, outputDir, options = {}) {
    const { timeoutMs = 600_000, onProgress, onStatus, } = options;
    if (files.length === 0)
        return new Map();
    if (process.platform !== 'win32') {
        logger_1.logger.warn('WordPDF', 'Not on Windows — cannot use Word COM');
        return new Map();
    }
    const available = await isWordAvailable();
    if (!available)
        return new Map();
    fs.mkdirSync(outputDir, { recursive: true });
    if (onStatus)
        onStatus(`Konvertiere ${files.length} Word-Dokumente via Microsoft Word...`);
    logger_1.logger.info('WordPDF', `Converting ${files.length} files via Word COM`);
    // Write file list to a separate text file — avoids ALL path escaping issues
    // (apostrophes, commas, parentheses, umlauts all handled correctly)
    const fileListContent = buildFileList(files, outputDir);
    const fileListPath = path.join(outputDir, '_filelist.txt');
    // Both files written with UTF-8 BOM for correct umlaut handling
    const bom = Buffer.from([0xEF, 0xBB, 0xBF]);
    fs.writeFileSync(fileListPath, Buffer.concat([bom, Buffer.from(fileListContent, 'utf-8')]));
    const psScript = buildBatchPowerShellScript(fileListPath, files.length);
    const scriptPath = path.join(outputDir, '_convert.ps1');
    fs.writeFileSync(scriptPath, Buffer.concat([bom, Buffer.from(psScript, 'utf-8')]));
    logger_1.logger.debug('WordPDF', `Script written to: ${scriptPath} (${files.length} files in list)`);
    return new Promise((resolve) => {
        const startTime = Date.now();
        // Execute via -File (not -Command) to preserve UTF-8 encoding
        (0, child_process_1.execFile)('powershell.exe', [
            '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
            '-File', scriptPath,
        ], {
            timeout: timeoutMs,
            maxBuffer: 10 * 1024 * 1024,
        }, (error, stdout, stderr) => {
            // Cleanup temp files
            try {
                fs.unlinkSync(scriptPath);
            }
            catch { /* ignore */ }
            try {
                fs.unlinkSync(fileListPath);
            }
            catch { /* ignore */ }
            const resultMap = new Map();
            let okCount = 0;
            let failCount = 0;
            // Parse stdout for OK: and FAIL: lines
            const lines = stdout.split('\n');
            for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed.startsWith('OK:')) {
                    const parts = trimmed.substring(3).split('|');
                    if (parts.length === 2) {
                        const inputPath = parts[0];
                        const outputPath = parts[1];
                        if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
                            resultMap.set(inputPath, outputPath);
                            okCount++;
                        }
                    }
                }
                else if (trimmed.startsWith('FAIL:')) {
                    failCount++;
                    const errInfo = trimmed.substring(5);
                    logger_1.logger.debug('WordPDF', `Failed: ${errInfo}`);
                }
                else if (trimmed.startsWith('PROGRESS:')) {
                    // PROGRESS:done:total
                    const parts = trimmed.substring(9).split(':');
                    const done = parseInt(parts[0], 10);
                    const total = parseInt(parts[1], 10);
                    if (onProgress && !isNaN(done) && !isNaN(total)) {
                        onProgress(done, total);
                    }
                }
            }
            if (error) {
                logger_1.logger.warn('WordPDF', `PowerShell ended with error: ${error.message}`);
            }
            if (stderr) {
                const stderrLines = stderr.split('\n').filter((l) => l.trim().length > 0);
                if (stderrLines.length > 0) {
                    logger_1.logger.debug('WordPDF', `stderr: ${stderrLines[0].substring(0, 200)}`);
                }
            }
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            logger_1.logger.info('WordPDF', `Done: ${okCount} succeeded, ${failCount} failed in ${elapsed}s`);
            if (onStatus)
                onStatus(`${okCount} Dokumente konvertiert (${elapsed}s)`);
            resolve(resultMap);
        });
    });
}
/**
 * Build a file list and PowerShell script for batch Word→PDF conversion.
 *
 * KEY FIX: File paths are written to a SEPARATE text file (one input|output
 * pair per line), NOT embedded inline in the PowerShell script. This
 * completely avoids ALL escaping issues with apostrophes (e.g., "pian'e forte",
 * "I've got you"), commas, parentheses, and other special characters that
 * break PowerShell's single-quoted string parser.
 *
 * Design decisions:
 * - Documents.Open() uses ONLY the filename parameter — no optional params.
 * - SaveAs with wdFormatPDF (17) for broad compatibility.
 * - File list is UTF-8 BOM encoded for paths with German umlauts.
 */
function buildFileList(files, outputDir) {
    return files.map((f) => {
        const baseName = path.basename(f, path.extname(f));
        const outPath = path.join(outputDir, baseName + '.pdf');
        return `${f}|${outPath}`;
    }).join('\r\n');
}
function buildBatchPowerShellScript(fileListPath, totalFiles) {
    // The file list path itself may contain special characters, so we read it
    // via Get-Content which handles paths with apostrophes etc. natively.
    // We use -LiteralPath to avoid wildcard interpretation.
    const lines = [
        '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
        '$ErrorActionPreference = "Continue"',
        `$total = ${totalFiles}`,
        '$done = 0',
        '$wdFormatPDF = 17',
        '',
        'try {',
        '  $word = New-Object -ComObject Word.Application',
        '  $word.Visible = $false',
        '  $word.DisplayAlerts = 0',
        '} catch {',
        '  Write-Output "FAIL:Word konnte nicht gestartet werden: $_"',
        '  exit 1',
        '}',
        '',
        // Read file list — each line is "inputPath|outputPath"
        `$fileListPath = $MyInvocation.MyCommand.Path -replace '_convert\\.ps1$', '_filelist.txt'`,
        '$lines = Get-Content -LiteralPath $fileListPath -Encoding UTF8',
        '',
        'foreach ($line in $lines) {',
        '  if ([string]::IsNullOrWhiteSpace($line)) { continue }',
        '  $parts = $line.Split("|", 2)',
        '  if ($parts.Length -ne 2) { continue }',
        '  $inputPath = $parts[0]',
        '  $outputPath = $parts[1]',
        '  $done++',
        '  $doc = $null',
        '',
        '  try {',
        '    $doc = $word.Documents.Open($inputPath)',
        '    if ($doc -eq $null) {',
        '      Write-Output "FAIL:$inputPath|Document.Open returned null"',
        '      continue',
        '    }',
        '',
        '    $doc.SaveAs($outputPath, $wdFormatPDF)',
        '    $doc.Close(0)',
        '    Write-Output "OK:$inputPath|$outputPath"',
        '  } catch {',
        '    Write-Output "FAIL:$inputPath|$_"',
        '    try { if ($doc -ne $null) { $doc.Close(0) } } catch {}',
        '  }',
        '',
        '  if ($done % 5 -eq 0 -or $done -eq $total) {',
        '    Write-Output ("PROGRESS:" + $done + ":" + $total)',
        '  }',
        '}',
        '',
        'try {',
        '  $word.Quit()',
        '  [System.Runtime.Interopservices.Marshal]::ReleaseComObject($word) | Out-Null',
        '} catch {}',
        '',
        'Write-Output ("DONE:" + $done)',
    ];
    return lines.join('\r\n');
}
//# sourceMappingURL=word-to-pdf-converter.js.map