# Proyecto Viáticos

Entorno inicial para desarrollar colaborativamente un sistema de viáticos. Este repositorio todavía no implementa reglas de negocio: contiene únicamente el starter técnico que se usará cuando los requisitos estén definidos.

## Tecnologías instaladas

- React 19 + TypeScript + Vite
- Cloudflare Workers con el plugin oficial de Vite
- Vitest, ESLint y Prettier
- Integración continua para GitHub

## Inicio local

Requisitos: Node.js 22 o superior y pnpm 11.

```bash
pnpm install
pnpm cf-typegen
pnpm dev
```

Abre `http://localhost:5173`.

## Comandos

| Comando       | Propósito                                        |
| ------------- | ------------------------------------------------ |
| `pnpm dev`    | Inicia React y el Worker local.                  |
| `pnpm check`  | Valida tipos, lint, pruebas, formato y bindings. |
| `pnpm build`  | Genera el artefacto de producción.               |
| `pnpm deploy` | Compila y publica el starter en Cloudflare.      |

## Colaboración

Trabaja en una rama independiente y abre un pull request:

```bash
git switch -c feat/nombre-del-cambio
git add .
git commit -m "feat: describir el cambio"
git push -u origin feat/nombre-del-cambio
```

Consulta [CONTRIBUTING.md](./CONTRIBUTING.md) para el acuerdo de trabajo. No agregues secretos ni datos personales al repositorio.

## Alcance actual

El starter solo incluye una pantalla de confirmación y un endpoint de salud en `/api/health`. Las pantallas, datos, aprobaciones, roles y reglas de viáticos se definirán antes de implementarlos.
