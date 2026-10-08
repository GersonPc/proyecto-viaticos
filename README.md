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

Los borradores sin enviar viven en la memoria de la página y se borran al recargar. Al pulsar **Enviar solicitud**, los datos y adjuntos se guardan en D1 y aparecen en **Mis solicitudes** y **Administración**. La firma solo persiste cuando la persona acepta guardarla. La firma del PDF de referencia y sus datos de ejemplo no se incorporan a la plantilla. Los revisores y datos administrativos del formato permanecen fijos.

Para exportar, pulsa **Generar PDF**. La aplicación prepara un archivo con transferencia y mapas en carta vertical, y solicitud en carta horizontal. El nombre usa el primer Service Ticket (o el primer ticket de proyecto si no hay Service Ticket) y el primer cliente seleccionado, por ejemplo `Solicitud de viáticos - Ticket 123 - Banco Gte.pdf`. Cuando esté listo, pulsa **Ver PDF** para revisarlo, **Compartir PDF** para abrir las aplicaciones disponibles en el sistema, o **Descargar PDF** para guardarlo y adjuntarlo manualmente. El menú de compartir depende del navegador y del sistema operativo; en producción requiere HTTPS. En `localhost` puedes probar la generación y descarga sin usar un correo real. La aplicación no envía mensajes: la persona elige la aplicación, revisa el destinatario y confirma el envío allí.

### Regenerar las plantillas

Los scripts extraen únicamente el contenido fijo de cada PDF original y conservan las posiciones de sus caracteres y las fuentes incrustadas. Requieren Python con `pdfplumber` y `pypdf`:

```bash
python scripts/build-transfer-template.py /ruta/al/pdf-de-transferencia.pdf
python scripts/build-request-template.py /ruta/al/pdf-de-solicitud.pdf
```

Las muestras generadas y archivos temporales están excluidos de Git.

## Administración y solicitudes persistentes

**Enviar solicitud** guarda una versión completa del formulario, mapas, cotizaciones y firma de esa solicitud. Se conserva el flujo de generación de PDF. Los borradores sin enviar siguen siendo temporales. La cuenta bancaria permanece en el directorio privado y no se copia en las solicitudes ni se envía a administración. El nombre y propietario se obtienen en el servidor de la identidad verificada, y los montos se recalculan con el mismo modelo usado por el formulario.

- **Mis solicitudes** muestra solamente los envíos de la persona autenticada. Una rechazada puede abrirse con **Editar y reenviar**, conservando todos sus datos y adjuntos. El reenvío mantiene su identificador, crea una nueva versión y vuelve a Pendientes. Pendientes y aceptadas quedan cerradas a edición; puede iniciarse una solicitud nueva.
- **Administración** muestra una tabla con nombre, fecha de solicitud, entrada a administración, salida y regreso del viaje, clientes, destinos, tickets, kilómetros, monto y estado. Los desplegables incluyen objetivo, gastos por categoría y día, insumos y reparaciones. La tabla administrativa no devuelve cuentas, firmas ni imágenes. La consulta de una liquidación aceptada permite a administradores ver los comprobantes y la firma utilizada, sin exponer datos bancarios.
- **Fecha de entrada** significa el momento en que la solicitud llega a administración, registrado por el servidor al enviar o reenviar. Se guarda en UTC y se muestra en horario de Guatemala. Las fechas del viaje son fechas de calendario sin conversiones horarias.
- **Aceptar** y **Rechazar** requieren registrar la decisión desde el panel de revisión. La observación es opcional. Aceptadas quedan en su apartado; las aceptadas habilitan la liquidación del viaje.
- `gpac@tecnasa.com` es el administrador principal inicial. Solo él puede agregar o quitar administradores desde **Administradores · Gestionar acceso**. Los administradores adicionales pueden revisar solicitudes, pero no gestionar permisos. El principal conserva su acceso. La identidad se verifica con Cloudflare Access antes de consultar los roles en D1; no existen permisos por botones, parámetros del navegador o almacenamiento local.

La migración `0003_requests.sql` agrega tablas sin modificar cuentas ni firmas existentes. Aplicar **antes de publicar** el código:

```bash
pnpm exec wrangler d1 migrations apply proyecto-viaticos-accounts --local
pnpm exec wrangler d1 execute proyecto-viaticos-accounts --local --file scripts/seed-local.sql
# Producción, durante la publicación de esta versión:
pnpm exec wrangler d1 migrations apply proyecto-viaticos-accounts --remote
```

`seed-local.sql` concede permisos de principal a `dev@tecnasa.com` únicamente en el entorno local. No ejecutar ese archivo contra producción.

Los envíos usan UUID y una clave de reintento para evitar duplicados. Las decisiones y reenvíos comparan la versión vigente para impedir que dos revisores o dos pestañas sobrescriban cambios. Cada envío y decisión registra actor, estado, observación y momento. El almacenamiento del formulario, sus adjuntos y el evento se confirma en una transacción; un fallo revierte el envío completo. Se conservan las versiones anteriores.

Esta versión admite hasta 8 MB por envío completo, hasta 30 imágenes PNG/JPG/WebP de hasta 5 MB cada una y viajes de hasta 366 días. El servidor valida esos límites y los datos; el usuario recibe un error si necesita reducir imágenes. Los snapshots JSON se dividen en filas de hasta 250.000 caracteres para respetar el [límite de tamaño de filas de D1](https://developers.cloudflare.com/d1/platform/limits/). El tamaño se controla también antes de interpretar JSON.

### Migración a otro proveedor

El modelo y los cálculos están en `src/request.ts` y `src/workflow.ts`. La interfaz `RequestRepository` separa la aplicación del adaptador `D1RequestRepository` en `worker/requestRepository.ts`. Los apartados también pueden abrirse directamente en `/mis-solicitudes` y `/administracion`. El frontend consume una API HTTP; migrar autenticación requiere sustituir el verificador de identidad, y migrar persistencia requiere implementar el contrato y conservar transacciones, auditoría y control de versiones. No basta con cambiar una URL.

Para respaldar todos los datos, incluidos cuentas y firmas, usa la [exportación SQL oficial de D1](https://developers.cloudflare.com/d1/best-practices/import-export-data/):

```bash
pnpm exec wrangler d1 export proyecto-viaticos-accounts --remote --output /private/tmp/viaticos-backup.sql
```

Para migrar solicitudes sin depender del formato interno de filas o de D1, convierte ese respaldo a JSON:

```bash
python3 scripts/export-requests.py /private/tmp/viaticos-backup.sql --output /private/tmp/viaticos-requests.json
```

El JSON tiene `schemaVersion: 1`, importes en centavos de GTQ, kilómetros en centésimas, timestamps UTC, administradores, auditoría y todos los snapshots reconstruidos con sus adjuntos. No incluye cuentas bancarias ni las firmas personales del directorio; sí incluye las firmas usadas en cada solicitud. El respaldo SQL completo debe conservarse para migrar también el directorio. Los índices y triggers de la migración son SQL de SQLite y deberán adaptarse si el destino utiliza otro motor.

Antes de cambiar de proveedor: detener temporalmente escrituras, exportar, importar en el destino, comparar cantidades de solicitudes/versiones/eventos y totales, comprobar el contenido de adjuntos y probar acceso por propietario, rechazo/reenvío y revisión simultánea. Cambiar el tráfico solamente después de esas comprobaciones. Conservar el respaldo de forma privada fuera de Git.

## Navegación y formulario por bloques

El botón **Menú**, en la esquina superior, reúne Solicitud, Mis solicitudes, Administración (según los permisos) y Nueva solicitud. Se puede cerrar al elegir una opción, pulsar Escape o tocar fuera. **Generar PDF** aparece junto a **Enviar solicitud**.

Transferencia aparece contraída cuando la cuenta está guardada. Fechas y colaborador, destinos, objetivo y clientes, y tickets muestran un resumen y se contraen al continuar fuera de un bloque completo. Un bloque reabierto para revisar permanece abierto hasta cerrarlo o editarlo y continuar. Los gastos y adjuntos conservan cierre manual para permitir completar varios días o imágenes. Los errores de validación abren los bloques del formulario. En pantallas pequeñas, el formulario aparece antes de la vista previa.

### Pegar capturas de mapas y cotizaciones

En **Mapas y cotizaciones**, copia la captura como imagen, selecciona la zona **Pega aquí tu captura** y pulsa **Ctrl+V** o **⌘+V**. También puedes usar **Pegar imagen**; el navegador puede solicitar permiso para leer el portapapeles. Si el permiso se rechaza o el botón no está disponible, usa la zona de pegado o **Elegir archivo**. No es necesario guardar la captura en el equipo.

Ambas opciones reutilizan la carga, validación y decodificación de los archivos adjuntos. Se conservan los límites de 30 imágenes, 5 MB por imagen y 8 MB por envío. Una imagen pegada aparece en la lista y en la vista previa del PDF, con kilómetros y fecha para completar. Pegar texto en los demás campos sigue funcionando normalmente. La lectura del portapapeles ocurre únicamente al pegar en la zona o pulsar el botón. No cambia la API ni el esquema de la base de datos.

## Liquidación de viáticos

Desde **Mis solicitudes**, una solicitud aceptada ofrece **Liquidar solicitud**. **Menú → Mis liquidaciones** reúne las aceptadas con estados Por liquidar, Borrador y Finalizada. Las pendientes y rechazadas no habilitan el cierre. El acceso directo a un expediente usa `/liquidaciones?solicitud=<id>`.

El formulario conserva colaborador, fechas, clientes, tickets, monto autorizado y firma de la solicitud aceptada. Permite editar fecha de liquidación, departamento y observaciones. Cada factura tiene fecha, serie, número de DTE (texto, conserva ceros), NIT, proveedor, concepto y monto. IDP, base e IVA son opcionales y se copian del comprobante; no se infieren impuestos. El monto autorizado se usa también como monto depositado, como en las referencias actuales; esta versión no registra transferencias bancarias reales.

**Factura / Reintegro** cambia el tipo de la siguiente carga. También puede cambiarse desde cada comprobante. Los reintegros registran devoluciones a TECNASA y quedan fuera de los gastos y sus impuestos. El resumen calcula saldo a reintegrar, reintegro adjunto, saldo pendiente y, si corresponde, saldo a favor del colaborador, con sumas en centavos.

Se pueden elegir varias imágenes o pegar capturas. El navegador optimiza las imágenes (hasta 1600 píxeles en su lado mayor) y recorta únicamente márgenes casi blancos, con un margen protector. **Recortar márgenes** permite recuperar la imagen completa; **Ajustar imagen** permite girarla o recortar manualmente el fondo con vista previa. Las fotos cuyo fondo no es blanco conservan sus bordes hasta ajustar el recorte. Las imágenes originales optimizadas y sus recortes quedan en el expediente privado.

**Guardar borrador** permite continuar tras recargar. **Finalizar liquidación** valida datos, fechas dentro del viaje, serie/DTE repetidos, montos y comprobantes de reintegro que cubran el saldo a devolver, y muestra un resumen antes de cerrar. Una finalizada queda en consulta y descarga. Administración puede consultarla desde la fila aceptada mediante **Ver liquidación**; no modifica el expediente del colaborador.

**Generar PDF** produce la hoja de liquidación horizontal con las columnas de los ejemplos (Fecha, Serie / DTE, NIT, Nombre, Concepto, Valor, IDP, Base e IVA), totales y espacios de firma. Hay hojas de continuación si excede 15 facturas. Las hojas de comprobantes son carta vertical, con **dos imágenes verticales por hoja**, conservando proporciones y mostrando tipo, serie/DTE y monto. Un número impar deja el segundo espacio vacío. Facturas y reintegros mantienen el orden de carga. Un borrador puede generar una vista de trabajo; finaliza la liquidación para validar el expediente completo.

La migración aditiva `0004_liquidations.sql` debe aplicarse antes de publicar esta versión usando el [flujo de migraciones de D1](https://developers.cloudflare.com/d1/reference/migrations/):

```bash
pnpm exec wrangler d1 migrations apply proyecto-viaticos-accounts --local
# Al publicar en producción:
pnpm exec wrangler d1 migrations apply proyecto-viaticos-accounts --remote
```

No agrega bindings. Las escrituras comparan revisión y propietario, exigen una solicitud aceptada, usan claves de reintento y confirman metadatos, comprobantes y auditoría en una transacción. Se conservan versiones anteriores. La solicitud aprobada no se modifica. El expediente completo admite hasta 8 MB y 30 comprobantes; cada archivo de entrada puede tener hasta 10 MB antes de optimizarse. La exportación SQL completa de D1 incluye estas tablas. El exportador JSON de solicitudes existente no incluye liquidaciones; para respaldo o migración del cierre, conserva la exportación SQL completa.
