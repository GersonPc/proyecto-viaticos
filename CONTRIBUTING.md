# Guía de contribución

## Flujo de trabajo

1. Actualiza `main`: `git switch main && git pull`.
2. Crea una rama: `git switch -c feat/nombre-del-cambio`.
3. Instala dependencias con `pnpm install`.
4. Trabaja con `pnpm dev`.
5. Confirma que `pnpm check && pnpm build` finalicen correctamente.
6. Sube la rama y abre un pull request para revisión.

Usa prefijos `feat/`, `fix/`, `docs/` o `chore/`. Los mensajes de commit deben explicar una sola intención.

## Secretos

Los secretos locales vivirán en `.dev.vars`. En Cloudflare se crearán con `pnpm wrangler secret put NOMBRE`. Ninguno de esos valores debe entrar en Git.
