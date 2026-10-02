# Proyecto Viáticos

Formulario de viáticos con vista previa, generación de PDF y opción de compartirlo desde el navegador.

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
pnpm exec wrangler d1 migrations apply proyecto-viaticos-accounts --local
pnpm exec wrangler d1 execute proyecto-viaticos-accounts --local --file scripts/seed-local.sql
pnpm dev
```

Abre `http://localhost:5173`. Wrangler simula `dev@tecnasa.com` y la cuenta ficticia del archivo de prueba en la D1 local. Este flujo no pide correo ni verificación de acceso ni utiliza el buzón real.

## Comandos

| Comando       | Propósito                                        |
| ------------- | ------------------------------------------------ |
| `pnpm dev`    | Inicia React y el Worker local.                  |
| `pnpm check`  | Valida tipos, lint, pruebas, formato y bindings. |
| `pnpm build`  | Genera el artefacto de producción.               |
| `pnpm deploy` | Compila y publica el starter en Cloudflare.      |

## Publicación automática

Producción: <https://proyecto-viaticos.fybertechdisney.workers.dev/>.

Cloudflare Workers Builds está conectado a `GersonPc/proyecto-viaticos` con `main` como rama de producción. Cada push o merge a `main` inicia una compilación y, si termina correctamente, publica la nueva versión en el mismo dominio.

Configuración: directorio raíz `/`, compilación `npm run build` y despliegue `npx wrangler deploy`. El estado y los registros se consultan en Cloudflare → proyecto-viaticos → Implementaciones → Builds recientes. Si una compilación falla, producción conserva la última versión publicada correctamente.

## Directorio privado de cuentas

La cuenta se busca por el correo verificado de Cloudflare Access. Cualquier persona con un correo verificado terminado exactamente en `@tecnasa.com` puede entrar, aunque no figure en el listado. La aplicación nunca descarga el listado completo. El nombre y los datos bancarios registrados se muestran como solo lectura. Si no existe registro, la persona ingresa su nombre, banco, tipo y número y pulsa **Guardar cuenta**. Si su nombre ya aparece en el listado pero no tiene cuenta, completa solo los datos bancarios. La cuenta queda guardada en D1, asociada exclusivamente a su correo, y se carga en próximas sesiones. Se debe guardar antes de generar el PDF. Este registro inicial no permite reemplazar cuentas existentes.

La base D1 `proyecto-viaticos-accounts` ya está creada, enlazada en `wrangler.jsonc` y contiene 24 colaboradores, uno sin cuenta. Cloudflare Access protege el Worker en producción y vistas previas con una regla que permite direcciones verificadas de `@tecnasa.com` y sesiones de 24 horas. One-time PIN está disponible para iniciar sesión. La etiqueta AUD y el dominio del equipo están configurados en `wrangler.jsonc`. Antes de publicar esta integración:

1. Ejecuta `pnpm cf-typegen`, `pnpm check` y `pnpm build`.
2. Comprueba el acceso con un correo con cuenta, el correo sin cuenta y un correo `@tecnasa.com` ausente del listado antes de fusionar la rama en `main`. Comprueba que una cuenta nueva se cargue después de recargar y que se rechace un correo de otro dominio.

Para actualizar el listado más adelante, con el CSV fuera del repositorio, ejecuta `python3 scripts/prepare-account-import.py /ruta/listado.csv --output /private/tmp/account-import.sql`. El script valida correos duplicados y cuentas incompletas. Luego ejecuta `pnpm exec wrangler d1 execute ACCOUNTS_DB --remote --file /private/tmp/account-import.sql` y elimina el SQL temporal. La importación agrega o actualiza los correos del CSV; conserva las cuentas y firmas de quienes no aparecen en él, incluidas las cuentas ingresadas por los usuarios. Una cuenta vacía en el CSV conserva los datos bancarios ya guardados; una cuenta completa los actualiza.

El CSV y el SQL generado contienen datos bancarios: guárdalos fuera de Git y no compartas sus contenidos en registros o capturas. Para desarrollo local, `access.dev` simula `dev@tecnasa.com`; utiliza únicamente registros de prueba en la D1 local. Para probar el registro inicial, elimina únicamente esa cuenta ficticia de la D1 local y recarga.

## Firma personal guardada

Al seleccionar una firma por primera vez, la persona decide si desea guardarla para próximas solicitudes o usarla solo en la solicitud actual. La firma guardada se carga automáticamente al abrir la aplicación. Se puede quitar de la solicitud actual, reemplazar o eliminar la copia guardada desde el formulario. La firma se consulta y modifica solo mediante el correo `@tecnasa.com` verificado por Cloudflare Access, incluso cuando aún no figura en el directorio D1.

Las firmas se almacenan en una tabla separada de la misma D1 privada, mediante la migración `0002_signatures.sql`. Cada imagen se limita a 1,5 MB en D1; si el archivo original supera ese tamaño, el navegador intenta reducirlo antes de guardarlo. La firma no se incluye en Git ni se expone como archivo público. Antes de publicar esta versión, ejecuta `pnpm exec wrangler d1 migrations apply proyecto-viaticos-accounts --remote`.

## Colaboración en GitHub

Trabaja en una rama independiente y abre un pull request:

```bash
git switch -c feat/nombre-del-cambio
git add .
git commit -m "feat: describir el cambio"
git push -u origin feat/nombre-del-cambio
```

Consulta [CONTRIBUTING.md](./CONTRIBUTING.md) para el acuerdo de trabajo. No agregues secretos ni datos personales al repositorio.

## Alcance actual

Las páginas de transferencia y solicitud reproducen los formatos de referencia en carta vertical (612 × 792 puntos) y horizontal (792 × 612 puntos), respectivamente. Los encabezados, líneas, logo, fuentes y datos administrativos fijos se conservan en `public/transfer-template.svg` y `public/request-template.svg`.

- El nombre se obtiene del registro asociado al correo verificado o se captura al registrar una cuenta por primera vez. Alimenta los campos de la misma persona en ambos documentos. La firma es una imagen opcional compartida entre ambas hojas; cada usuario decide si la conserva para próximas solicitudes.
- El número de cuenta, tipo y banco provienen de D1 y se muestran como solo lectura. La persona sin cuenta registrada puede ingresarlos y guardarlos para sus próximas solicitudes. El cargo permanece como Microsistemas.
- La fecha de solicitud, el objetivo específico y el detalle del ticket se capturan en Solicitud y se reutilizan en Transferencia.
- Las fechas de salida y regreso son independientes de la fecha de solicitud. Los días se calculan incluyendo ambos extremos.
- Destinos, Service Tickets y tickets de proyecto son listas independientes de etiquetas. En el PDF se separan con comas.
- Cada imagen de mapa o cotización tiene kilómetros editables y una fecha dentro del viaje. Para cotizaciones sin recorrido se indica 0 km.
- Los kilómetros totales suman todas las imágenes. El combustible de cada imagen se calcula a Q1.30/km, redondeado a centavos, y se asigna a su fecha. Varias imágenes del mismo día suman sus importes; editar o eliminar una imagen recalcula los totales.
- Desayuno, almuerzo y cena se marcan Sí/No por día, con tarifas fijas de Q50, Q75 y Q75. Hospedaje y cuatro gastos adicionales con nombres editables conservan importes manuales. El total calculado alimenta también la transferencia.
- Los gastos fuera del rango de fechas se conservan en el borrador, pero se excluyen del total. Los viajes largos usan hojas de continuación de 12 columnas; se admiten hasta 366 días.
- Se mantienen las páginas de mapas y cotizaciones, con tres imágenes por página.

Los datos de cada solicitud viven en la memoria de la página y se borran al recargar. La firma solo persiste cuando la persona acepta guardarla. La firma del PDF de referencia y sus datos de ejemplo no se incorporan a la plantilla. Los revisores y datos administrativos del formato permanecen fijos.

Para exportar, pulsa **Generar PDF**. La aplicación prepara un archivo con transferencia y mapas en carta vertical, y solicitud en carta horizontal. El nombre usa el primer Service Ticket (o el primer ticket de proyecto si no hay Service Ticket) y el primer cliente seleccionado, por ejemplo `Solicitud de viáticos - Ticket 123 - Banco Gte.pdf`. Cuando esté listo, pulsa **Ver PDF** para revisarlo, **Compartir PDF** para abrir las aplicaciones disponibles en el sistema, o **Descargar PDF** para guardarlo y adjuntarlo manualmente. El menú de compartir depende del navegador y del sistema operativo; en producción requiere HTTPS. En `localhost` puedes probar la generación y descarga sin usar un correo real. La aplicación no envía mensajes: la persona elige la aplicación, revisa el destinatario y confirma el envío allí.

### Regenerar las plantillas

Los scripts extraen únicamente el contenido fijo de cada PDF original y conservan las posiciones de sus caracteres y las fuentes incrustadas. Requieren Python con `pdfplumber` y `pypdf`:

```bash
python scripts/build-transfer-template.py /ruta/al/pdf-de-transferencia.pdf
python scripts/build-request-template.py /ruta/al/pdf-de-solicitud.pdf
```

Las muestras generadas y archivos temporales están excluidos de Git.
