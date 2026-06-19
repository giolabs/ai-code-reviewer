const REQUIRED_FIELDS = ['summary', 'findings', 'recommendation'];
export function parseReviewJSON(raw) {
    // Strategy 1: direct parse
    const direct = tryParse(raw);
    if (direct)
        return validate(direct);
    // Strategy 2: strip markdown code fences
    const stripped = raw.replace(/^```(?:json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '');
    const fenced = tryParse(stripped);
    if (fenced)
        return validate(fenced);
    // Strategy 3: extract first {...} substring
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
        const extracted = tryParse(match[0]);
        if (extracted)
            return validate(extracted);
    }
    throw new Error(`No se pudo parsear la respuesta del LLM como JSON. Respuesta raw: ${raw.slice(0, 200)}`);
}
function tryParse(str) {
    try {
        const parsed = JSON.parse(str);
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
            return parsed;
        }
        return null;
    }
    catch {
        return null;
    }
}
function validate(obj) {
    const missing = REQUIRED_FIELDS.filter((f) => !(f in obj));
    if (missing.length > 0) {
        throw new Error(`La respuesta del LLM no tiene la estructura esperada. Campos faltantes: ${missing.join(', ')}`);
    }
    return {
        summary: obj.summary,
        overallScore: typeof obj.overallScore === 'number' ? obj.overallScore : undefined,
        recommendation: obj.recommendation,
        findings: Array.isArray(obj.findings)
            ? obj.findings.map((f) => ({
                file: f.file ?? '',
                line: f.line ?? 0,
                severity: f.severity ?? 'info',
                category: f.category ?? 'maintainability',
                title: f.title ?? '',
                description: f.description ?? '',
                suggestion: f.suggestion ? f.suggestion : undefined,
            }))
            : [],
    };
}
