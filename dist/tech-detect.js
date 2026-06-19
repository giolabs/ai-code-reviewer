import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
/**
 * Detecta el tech stack del proyecto leyendo `package.json` y archivos
 * característicos del root. El orden importa: stacks más específicos primero
 * (Next.js antes que React, NestJS antes que node).
 */
export function detectTechStack(cwd = process.cwd()) {
    const pkgPath = resolve(cwd, 'package.json');
    // Detección por archivos non-JS primero
    if (existsSync(resolve(cwd, 'pubspec.yaml')))
        return 'flutter';
    if (existsSync(resolve(cwd, 'composer.json')))
        return 'laravel';
    if (!existsSync(pkgPath))
        return 'generic';
    let pkg;
    try {
        pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    }
    catch {
        return 'generic';
    }
    const allDeps = {
        ...(pkg.dependencies ?? {}),
        ...(pkg.devDependencies ?? {}),
    };
    if (allDeps['next'])
        return 'nextjs';
    if (allDeps['@nestjs/core'])
        return 'nestjs';
    if (allDeps['react'])
        return 'react';
    if (allDeps['typescript'])
        return 'typescript';
    return 'node';
}
/**
 * Devuelve un nombre legible del tech stack para mostrar al usuario.
 */
export function techDisplayName(tech) {
    const map = {
        nestjs: 'NestJS',
        react: 'React',
        nextjs: 'Next.js',
        typescript: 'TypeScript',
        node: 'Node.js',
        flutter: 'Flutter',
        laravel: 'Laravel',
        generic: 'Generic',
    };
    return map[tech];
}
