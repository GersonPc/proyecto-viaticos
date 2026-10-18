# Publicación y regreso a la versión anterior

Publicación del 3 de octubre de 2026 UTC (2 de octubre en Guatemala).

- Aplicación: https://proyecto-viaticos.fybertechdisney.workers.dev/
- Versión publicada: `0721b2ed-c0ce-4fef-a6ae-24626951eac7`.
- Versión anterior: `15918e65-9229-44b0-aa66-00acfe569ff6`.
- Migración aplicada: `0003_requests.sql`, que agrega tablas sin cambiar cuentas ni firmas.
- Validación: 68 pruebas, tipos, lint, formato y compilación. Cloudflare confirma la nueva versión con el 100 % del tráfico. Las rutas `/`, `/api/session`, `/api/requests` y `/administracion` redirigen a Cloudflare Access sin una sesión. La revisión de la interfaz en producción requiere iniciar sesión con un correo autorizado.

## Volver a la aplicación anterior

Desde la raíz del proyecto, con Node y la sesión de Wrangler disponibles:

```bash
pnpm exec wrangler rollback 15918e65-9229-44b0-aa66-00acfe569ff6 --name proyecto-viaticos --message "Regreso a la versión anterior a administración y formulario compacto"
pnpm exec wrangler deployments list --json
```

Confirmar que la versión anterior atiende el 100 % del tráfico. También se puede elegir esa versión en Cloudflare → Workers & Pages → proyecto-viaticos → Deployments → Rollback. [Documentación oficial](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/).

Este regreso cambia código y archivos de la aplicación. Conserva la base y las solicitudes creadas desde la publicación. Las tablas adicionales son compatibles con el código anterior, aunque esa interfaz no permite consultar las nuevas solicitudes. No borrar tablas ni restaurar la base para un regreso normal de la aplicación.

Cloudflare limita el rollback a las 100 versiones más recientes. Se conserva además una copia local de la fuente Git anterior (`aca39d5d51c1c1f9766949a4cd24ab0cc166f315`) para reconstruirla y publicarla si deja de estar disponible en ese historial. Antes de reconstruir, revisar los bindings y conservar la base existente; una reconstrucción puede generar una versión con un identificador diferente.

## Respaldos privados

Se guardaron en `private-data/releases/2026-10-03-admin-menu/`, excluido de Git y con permisos privados:

- `database-before.sql`: exportación completa anterior a la migración; importada en SQLite temporal y verificada con `integrity_check`.
- `release.json` y `deployments-after.json`: versiones, despliegue, punto de recuperación D1 y resultados de las comprobaciones.
- `source.tar.gz` y `build.tar.gz`: fuente y artefactos de esta publicación.
- `previous-git-source.tar.gz`: copia de la fuente Git anterior.
- `checksums.json`: hashes SHA-256 de los respaldos y artefactos.

La migración conservó las 24 cuentas y la firma existente. Solo `gpac@tecnasa.com` se registró como principal; el administrador de prueba local no está en producción.

La restauración de D1 es una recuperación excepcional: reemplaza toda la base y puede perder escrituras posteriores al punto seleccionado. Antes de usarla, detener escrituras, exportar el estado actual y evaluar qué datos posteriores se conservarán. El punto anterior a esta publicación está registrado en `release.json`; no se ejecutó ninguna restauración. [Documentación oficial de Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/).

Estos archivos son una copia local. Para protegerse de la pérdida de este equipo, guardarlos en el almacenamiento privado de respaldos de la organización.

## Corrección de liquidaciones

9 de octubre de 2026, hora de Guatemala.

- Se actualizó la rama principal local hasta `58b1164`, igual a `origin/main`, sin cambios locales pendientes antes de la actualización.
- La base publicada tenía aplicadas las migraciones `0001`, `0002` y `0003`. Faltaba `0004_liquidations.sql` y no existían las tablas `travel_liquidations`, `liquidation_chunks` ni `liquidation_events`. Las rutas de lista, apertura y guardado dependían de esas tablas y devolvían el error genérico 503.
- Se aplicó únicamente la migración pendiente con `wrangler d1 migrations apply proyecto-viaticos-accounts --remote`. Después se verificaron las tres tablas, sus dos triggers de auditoría y el registro de las cuatro migraciones aplicadas.
- Antes y después: 24 cuentas, 1 firma y 3 solicitudes. No se editaron ni eliminaron esos registros; la migración agrega tablas y triggers. No se crearon liquidaciones de prueba en producción ni se republicó el Worker.
- Una prueba de regresión reproduce los errores de lista, apertura y guardado sin `0004`, aplica la migración y verifica respuestas 200, recuperación del borrador y conservación de las cuentas y solicitudes. Validación: 90 pruebas, tipos, lint, formato, bindings y compilación correctos.
- La comprobación visual en producción requiere iniciar sesión en Cloudflare Access. La base publicada se verificó directamente, pero no se dispone de una sesión de usuario para confirmar la interfaz publicada.

La configuración actual de Workers Builds ejecuta `npx wrangler deploy`; no aplica las migraciones de D1. Ejecutarlas contra producción antes de publicar futuros cambios de esquema. Actualizar Git o aplicar migraciones locales no sustituye ese paso.
