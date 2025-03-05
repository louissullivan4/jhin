function formatTimestamp(): string {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = now.getFullYear();
    return `[${hours}:${minutes}:${seconds} ${day}/${month}/${year}]`;
    }

    function colorizeLine(line: string, level: string): string {
    const reset = '\x1b[0m';
    switch (level.toUpperCase()) {
        case 'INFO':
        return `\x1b[32m${line}${reset}`; // green
        case 'WARN':
        return `\x1b[33m${line}${reset}`; // yellow
        case 'ERROR':
        return `\x1b[31m${line}${reset}`; // red
        case 'DEBUG':
        return `\x1b[35m${line}${reset}`; // purple
        default:
        return line;
    }
}
  
export function logMessage(level: string, lang: string, message: string): void {
    const timestamp = formatTimestamp();
    const line = `${timestamp} [${level.toUpperCase()}] [${lang}] ${message}`;
    const coloredLine = colorizeLine(line, level);
    console.log(coloredLine);
}
  