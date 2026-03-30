// ============================================================================
// BiBox Downloader — Disk Space Check
// ============================================================================
// [v2 NEW] Checks available disk space before starting downloads
// [Review2] Fixed: Command injection, WMIC deprecation, PowerShell fallback

import { execSync } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import { DiskSpaceInfo } from '../../shared/types';

export async function checkDiskSpace(targetPath: string): Promise<DiskSpaceInfo> {
  const platform = os.platform();

  try {
    if (platform === 'win32') {
      return checkDiskSpaceWindows(targetPath);
    } else {
      return checkDiskSpaceUnix(targetPath);
    }
  } catch {
    // If we can't check, return a large value to not block downloads
    return {
      available: Number.MAX_SAFE_INTEGER,
      total: Number.MAX_SAFE_INTEGER,
      path: targetPath,
    };
  }
}

/**
 * Sanitize a path for safe use in shell commands.
 * [Review3] FIX: Allow Unicode letters (Umlauts ä/ö/ü/ß, accented chars, etc.)
 * Only reject shell-dangerous characters: $, `, ", ', \n, ;, |, &, <, >, (, ), {, }
 */
function sanitizePath(p: string): string {
  // Resolve to absolute path first to normalize
  const resolved = path.resolve(p);
  // Reject shell metacharacters that could be used for injection
  if (/[\x00-\x1f`$"';|&<>(){}]/.test(resolved)) {
    throw new Error(`Path contains invalid characters: ${resolved}`);
  }
  // Must start with / on Unix
  if (!resolved.startsWith('/')) {
    throw new Error(`Not an absolute Unix path: ${resolved}`);
  }
  return resolved;
}

function checkDiskSpaceWindows(targetPath: string): DiskSpaceInfo {
  // Extract and validate drive letter
  const drive = targetPath.match(/^([a-zA-Z]:)/)?.[1];
  if (!drive) {
    throw new Error(`Cannot extract drive letter from path: ${targetPath}`);
  }

  // Use PowerShell Get-CimInstance (modern, available on all Windows 10/11)
  // Drive letter is validated above to be exactly [A-Z]: — safe for interpolation
  try {
    const psCommand = `powershell -NoProfile -NonInteractive -Command "Get-CimInstance -ClassName Win32_LogicalDisk -Filter \\"DeviceID='${drive}'\\" | Select-Object FreeSpace,Size | ConvertTo-Json"`;
    const output = execSync(psCommand, {
      encoding: 'utf-8',
      timeout: 10000,
      windowsHide: true,
    });

    const parsed = JSON.parse(output.trim());
    if (parsed && typeof parsed.FreeSpace === 'number' && typeof parsed.Size === 'number') {
      return {
        available: parsed.FreeSpace,
        total: parsed.Size,
        path: targetPath,
      };
    }
  } catch {
    // PowerShell failed — try legacy WMIC as fallback
  }

  // Fallback: WMIC (deprecated but may still be available)
  try {
    const output = execSync(
      `wmic logicaldisk where "DeviceID='${drive}'" get FreeSpace,Size /format:csv`,
      { encoding: 'utf-8', timeout: 5000, windowsHide: true }
    );

    const lines = output.trim().split('\n').filter((l) => l.trim());
    if (lines.length >= 2) {
      const parts = lines[lines.length - 1].split(',');
      if (parts.length >= 3) {
        return {
          available: parseInt(parts[1], 10) || 0,
          total: parseInt(parts[2], 10) || 0,
          path: targetPath,
        };
      }
    }
  } catch {
    // Both PowerShell and WMIC failed
  }

  throw new Error('Could not determine disk space on Windows');
}

function checkDiskSpaceUnix(targetPath: string): DiskSpaceInfo {
  // Sanitize path to prevent command injection
  const safePath = sanitizePath(targetPath);

  // Use df command with sanitized path
  const output = execSync(`df -B1 "${safePath}" 2>/dev/null`, {
    encoding: 'utf-8',
    timeout: 5000,
  });

  const lines = output.trim().split('\n');
  if (lines.length >= 2) {
    const parts = lines[1].split(/\s+/);
    if (parts.length >= 4) {
      return {
        available: parseInt(parts[3], 10) || 0,
        total: parseInt(parts[1], 10) || 0,
        path: targetPath,
      };
    }
  }

  throw new Error('Could not parse df output');
}
