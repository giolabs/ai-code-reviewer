import chalk from 'chalk';
const severityColors = {
    critical: chalk.bgRed.white.bold,
    major: chalk.red.bold,
    minor: chalk.yellow,
    info: chalk.cyan,
    nitpick: chalk.gray,
};
const severityOrder = {
    critical: 0,
    major: 1,
    minor: 2,
    info: 3,
    nitpick: 4,
};
export function sortFindings(findings) {
    return [...findings].sort((a, b) => {
        const sevDiff = severityOrder[a.severity] - severityOrder[b.severity];
        if (sevDiff !== 0)
            return sevDiff;
        if (a.file !== b.file)
            return a.file.localeCompare(b.file);
        return a.line - b.line;
    });
}
/**
 * Imprime el review en terminal con colores.
 */
export function printReviewToTerminal(result) {
    console.log();
    console.log(chalk.bold.underline('🤖 AI Code Review'));
    console.log();
    console.log(chalk.bold('Resumen:'));
    console.log(result.summary);
    console.log();
    if (typeof result.overallScore === 'number') {
        const scoreColor = result.overallScore >= 8
            ? chalk.green
            : result.overallScore >= 5
                ? chalk.yellow
                : chalk.red;
        console.log(`${chalk.bold('Score:')} ${scoreColor(`${result.overallScore}/10`)}`);
    }
    const recColor = result.recommendation === 'approve'
        ? chalk.green
        : result.recommendation === 'request_changes'
            ? chalk.red
            : chalk.yellow;
    console.log(`${chalk.bold('Recomendación:')} ${recColor(result.recommendation)}`);
    console.log();
    if (result.findings.length === 0) {
        console.log(chalk.green('✓ Sin findings.'));
    }
    else {
        console.log(chalk.bold(`Findings (${result.findings.length}):`));
        console.log();
        for (const f of sortFindings(result.findings)) {
            const sev = severityColors[f.severity](` ${f.severity.toUpperCase()} `);
            console.log(`${sev} ${chalk.dim(`[${f.category}]`)} ${chalk.bold(f.title)}`);
            console.log(`  ${chalk.dim(`${f.file}:${f.line}`)}`);
            console.log(`  ${f.description}`);
            if (f.suggestion) {
                console.log(chalk.dim('  Sugerencia:'));
                for (const line of f.suggestion.split('\n')) {
                    console.log(chalk.dim(`    ${line}`));
                }
            }
            console.log();
        }
    }
    if (result.tokensUsed) {
        console.log(chalk.dim(`Tokens usados: ${result.tokensUsed.total} (prompt: ${result.tokensUsed.prompt}, completion: ${result.tokensUsed.completion})`));
    }
}
/**
 * Convierte el review a markdown (para guardar a archivo o como PR comment).
 */
export function reviewToMarkdown(result) {
    const lines = ['# 🤖 AI Code Review', '', '## Resumen', '', result.summary, ''];
    if (typeof result.overallScore === 'number') {
        lines.push(`**Score:** ${result.overallScore}/10`);
    }
    lines.push(`**Recomendación:** \`${result.recommendation}\``, '');
    if (result.findings.length === 0) {
        lines.push('## Findings', '', '✅ Sin findings.', '');
    }
    else {
        lines.push('## Findings', '');
        for (const f of sortFindings(result.findings)) {
            lines.push(`### ${severityBadge(f.severity)} ${f.title}`, '', `- **Archivo:** \`${f.file}:${f.line}\``, `- **Categoría:** \`${f.category}\``, '', f.description);
            if (f.suggestion) {
                lines.push('', '**Sugerencia:**', '', f.suggestion);
            }
            lines.push('');
        }
    }
    if (result.tokensUsed) {
        lines.push('---', '', `_Tokens: ${result.tokensUsed.total} (prompt ${result.tokensUsed.prompt} + completion ${result.tokensUsed.completion})_`);
    }
    return lines.join('\n');
}
function severityBadge(severity) {
    const map = {
        critical: '🔴 CRITICAL',
        major: '🟠 MAJOR',
        minor: '🟡 MINOR',
        info: '🔵 INFO',
        nitpick: '⚪ NITPICK',
    };
    return map[severity];
}
/**
 * Filtra findings por severidad mínima.
 */
export function filterBySeverity(findings, minSeverity) {
    const threshold = severityOrder[minSeverity];
    return findings.filter((f) => severityOrder[f.severity] <= threshold);
}
