import chalk from 'chalk';
import type { ReviewResult, ReviewFinding, Severity } from './types.js';

const severityColors: Record<Severity, (s: string) => string> = {
  critical: chalk.bgRed.white.bold,
  major: chalk.red.bold,
  minor: chalk.yellow,
  info: chalk.cyan,
  nitpick: chalk.gray,
};

const severityOrder: Record<Severity, number> = {
  critical: 0,
  major: 1,
  minor: 2,
  info: 3,
  nitpick: 4,
};

function severityBadge(severity: Severity): string {
  const map: Record<Severity, string> = {
    critical: '🔴 CRITICAL',
    major: '🟠 MAJOR',
    minor: '🟡 MINOR',
    info: '🔵 INFO',
    nitpick: '⚪ NITPICK',
  };
  return map[severity];
}

export class OutputFormatter {
  sortFindings(findings: ReadonlyArray<ReviewFinding>): ReviewFinding[] {
    return [...findings].sort((a, b) => {
      const sevDiff = severityOrder[a.severity] - severityOrder[b.severity];
      if (sevDiff !== 0) return sevDiff;
      if (a.file !== b.file) return a.file.localeCompare(b.file);
      return a.line - b.line;
    });
  }

  filterBySeverity(
    findings: ReadonlyArray<ReviewFinding>,
    minSeverity: Severity,
  ): ReviewFinding[] {
    const threshold = severityOrder[minSeverity];
    return findings.filter((f) => severityOrder[f.severity] <= threshold);
  }

  print(result: ReviewResult): void {
    console.log();
    console.log(chalk.bold.underline('🤖 AI Code Review'));
    console.log();
    console.log(chalk.bold('Resumen:'));
    console.log(result.summary);
    console.log();

    if (typeof result.overallScore === 'number') {
      const scoreColor =
        result.overallScore >= 8
          ? chalk.green
          : result.overallScore >= 5
            ? chalk.yellow
            : chalk.red;
      console.log(`${chalk.bold('Score:')} ${scoreColor(`${result.overallScore}/10`)}`);
    }

    const recColor =
      result.recommendation === 'approve'
        ? chalk.green
        : result.recommendation === 'request_changes'
          ? chalk.red
          : chalk.yellow;
    console.log(`${chalk.bold('Recomendación:')} ${recColor(result.recommendation)}`);
    console.log();

    if (result.findings.length === 0) {
      console.log(chalk.green('✓ Sin findings.'));
    } else {
      console.log(chalk.bold(`Findings (${result.findings.length}):`));
      console.log();
      for (const f of this.sortFindings(result.findings)) {
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

    const anticipatedBugs = result.anticipatedBugs ?? [];
    if (anticipatedBugs.length > 0) {
      console.log(chalk.bold(`Bugs Anticipados (${anticipatedBugs.length}):`));
      console.log();
      for (const f of this.sortFindings(anticipatedBugs)) {
        const sev = severityColors[f.severity](` ${f.severity.toUpperCase()} `);
        console.log(`${sev} ${chalk.dim(`[${f.category}]`)} ${chalk.bold(f.title)}`);
        console.log(`  ${chalk.dim(`${f.file}:${f.line}`)}`);
        console.log(`  ${f.description}`);
        console.log();
      }
    }

    const regressionRisks = result.regressionRisks ?? [];
    if (regressionRisks.length > 0) {
      console.log(chalk.bold(`Riesgos de Regresión (${regressionRisks.length}):`));
      console.log();
      for (const r of regressionRisks) {
        console.log(`${chalk.yellow('⚠')} ${chalk.bold(r.symbol)} en ${chalk.dim(r.file)}`);
        console.log(`  ${r.reason}`);
        console.log();
      }
    }

    if (result.tokensUsed) {
      console.log(
        chalk.dim(
          `Tokens usados: ${result.tokensUsed.total} (prompt: ${result.tokensUsed.prompt}, completion: ${result.tokensUsed.completion})`,
        ),
      );
    }
  }

  toMarkdown(result: ReviewResult): string {
    const lines: string[] = ['# 🤖 AI Code Review', '', '## Resumen', '', result.summary, ''];

    if (typeof result.overallScore === 'number') {
      lines.push(`**Score:** ${result.overallScore}/10`);
    }
    lines.push(`**Recomendación:** \`${result.recommendation}\``, '');

    if (result.findings.length === 0) {
      lines.push('## Findings', '', '✅ Sin findings.', '');
    } else {
      lines.push('## Findings', '');
      for (const f of this.sortFindings(result.findings)) {
        lines.push(
          `### ${severityBadge(f.severity)} ${f.title}`,
          '',
          `- **Archivo:** \`${f.file}:${f.line}\``,
          `- **Categoría:** \`${f.category}\``,
          '',
          f.description,
        );
        if (f.suggestion) {
          lines.push('', '**Sugerencia:**', '', f.suggestion);
        }
        lines.push('');
      }
    }

    const anticipatedBugs = result.anticipatedBugs ?? [];
    if (anticipatedBugs.length > 0) {
      lines.push('## 🐛 Bugs Anticipados', '');
      for (const f of this.sortFindings(anticipatedBugs)) {
        lines.push(
          `### ${severityBadge(f.severity)} ${f.title}`,
          '',
          `- **Archivo:** \`${f.file}:${f.line}\``,
          `- **Categoría:** \`${f.category}\``,
          '',
          f.description,
          '',
        );
      }
    }

    const regressionRisks = result.regressionRisks ?? [];
    if (regressionRisks.length > 0) {
      lines.push('## ⚠️ Riesgos de Regresión', '');
      for (const r of regressionRisks) {
        lines.push(
          `### \`${r.symbol}\` en \`${r.file}\``,
          '',
          r.reason,
          '',
        );
      }
    }

    if (result.tokensUsed) {
      lines.push(
        '---',
        '',
        `_Tokens: ${result.tokensUsed.total} (prompt ${result.tokensUsed.prompt} + completion ${result.tokensUsed.completion})_`,
      );
    }

    return lines.join('\n');
  }
}
