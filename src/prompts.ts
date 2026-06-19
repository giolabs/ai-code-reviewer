import type { ChangedFile, ReviewerConfig, TechStack } from './types.js';
import { techDisplayName } from './tech-detect.js';

export function buildSystemPrompt(args: {
  config: ReviewerConfig;
  tech: TechStack;
  mergedRulesText: string;
}): string {
  const { config, tech, mergedRulesText } = args;

  const enabledChecks = Object.entries(config.checks)
    .filter(([, on]) => on)
    .map(([k]) => k)
    .join(', ');

  const langInstruction =
    config.language === 'es'
      ? 'Respondé SIEMPRE en español rioplatense, claro y profesional.'
      : 'Always respond in clear, professional English.';

  const sections = [
    `Sos un Senior Staff Engineer especializado en code review. Tu objetivo es revisar cambios de código con la rigurosidad de un reviewer experimentado: detectar bugs reales, riesgos de seguridad, problemas de performance, y problemas de mantenibilidad. NO sos un linter — no señales cosas triviales que un linter o formatter resolvería automáticamente.`,

    `**Stack del proyecto:** ${techDisplayName(tech)}`,

    `**Categorías de checks habilitadas:** ${enabledChecks}
Ignorá categorías deshabilitadas. Si un check está apagado, NO generes findings de esa categoría aunque los veas.`,

    `**Severidad mínima a reportar:** ${config.minSeverity}
Escala (de mayor a menor): critical > major > minor > info > nitpick.
- critical: bug que rompe producción, vulnerabilidad explotable, pérdida de datos.
- major: bug probable, problema de seguridad sin exploit directo, performance issue serio.
- minor: code smell relevante, edge case mal manejado, falta de error handling.
- info: observación útil, mejora opcional.
- nitpick: estilo, naming, micro-optimización.
NO reportes findings por debajo de la severidad mínima.`,

    `**Reglas de review (merged: proyecto > global):**
${mergedRulesText || '(sin reglas — aplicá best practices generales)'}`,
  ];

  if (config.customInstructions) {
    sections.push(`**Instrucciones adicionales del usuario:**\n${config.customInstructions}`);
  }

  sections.push(
    `**Cómo señalar líneas:**
- El campo \`line\` debe ser el número de línea en el archivo NUEVO (lado derecho del diff).
- Solo señalá líneas que están en el diff (líneas que empiezan con + en el patch, o contexto inmediato). Las inline comments solo funcionan ahí.
- Si el problema es sobre el archivo en general (no una línea específica), usá la primera línea cambiada del archivo y aclaralo en la descripción.`,

    `**Calidad sobre cantidad:**
- Si el PR está bien, decilo explícitamente en el summary y devolvé pocos findings (o cero).
- No inventes problemas para "llenar" el review.
- Cada finding debe tener un razonamiento concreto, no vaguedades tipo "podría mejorarse".

${langInstruction}`,
  );

  return sections.join('\n\n');
}

/**
 * Construye el user prompt con el contenido a revisar. Trunca diffs gigantes
 * para no explotar el context window.
 */
export function buildUserPrompt(args: {
  files: ChangedFile[];
  prTitle?: string;
  prBody?: string | null;
  maxTotalChars?: number;
}): string {
  const { files, prTitle, prBody, maxTotalChars = 80_000 } = args;

  const parts: string[] = [];

  if (prTitle) {
    parts.push(`**Título del PR:** ${prTitle}`);
  }
  if (prBody) {
    parts.push(`**Descripción del PR:**\n${prBody}`);
  }

  parts.push(`**Archivos cambiados (${files.length}):**`);

  let totalChars = parts.join('\n\n').length;
  const fileChunks: string[] = [];

  for (const file of files) {
    if (!file.patch) {
      fileChunks.push(`### ${file.path} (${file.status}, sin patch disponible)`);
      continue;
    }

    const header = `### ${file.path} (${file.status}, +${file.additions}/-${file.deletions})`;
    const chunk = `${header}\n\`\`\`diff\n${file.patch}\n\`\`\``;

    if (totalChars + chunk.length > maxTotalChars) {
      fileChunks.push(
        `### ${file.path} (${file.status})\n_[Diff truncado por exceder el tamaño máximo del prompt.]_`,
      );
      totalChars += 120;
    } else {
      fileChunks.push(chunk);
      totalChars += chunk.length;
    }
  }

  parts.push(fileChunks.join('\n\n'));
  parts.push(
    `\nRevisá los cambios siguiendo las reglas e instrucciones del system prompt. Devolvé la respuesta en el formato JSON requerido.`,
  );

  return parts.join('\n\n');
}
