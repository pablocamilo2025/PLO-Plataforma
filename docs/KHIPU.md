# Integración de Khipu: preparación y activación

Estado: esquema y cuatro Edge Functions desplegadas únicamente en PLO Farma Demo el 26 de septiembre de 2026. Producción sin cambios. Checkout demo deshabilitado hasta configurar credenciales y usuario de prueba. La cuenta Khipu de desarrollo «PLO Farma — Desarrollo» (ID 529593) quedó activada con DemoBank el 26 de septiembre de 2026. El usuario indicó haber generado la API key; aún no se ha configurado en el servidor. No hay cobros ni pruebas integrales con Khipu. El botón público sigue deshabilitado.


## Entorno demo creado

- Proyecto Supabase: **PLO Farma Demo**.
- Project ref: `ceyjjkasemmdtcpdsfly`.
- Organización: Pablo Gajardo. Región: São Paulo (`sa-east-1`).
- Creado el 26 de septiembre de 2026; costo informado y aceptado: US$0/mes.
- Dashboard: https://supabase.com/dashboard/project/ceyjjkasemmdtcpdsfly
- Khipu de desarrollo: ID `529593`.
- Instalado: esquema completo, funciones `place-portal-order`, `create-khipu-payment`, `khipu-webhook` y `manage-portal-orders` (v1).
- Farmacia ficticia: `e8299232-a409-4990-a2ce-b49bce99acf9`, «DEMO — sin despacho real».
- Producto ficticio: ID `17`, SKU `PLO-9001`, neto $1.000, total esperado $1.190. Catálogo histórico desactivado en demo.
- Configurado: `KHIPU_MODE=development`, `KHIPU_RECEIVER_ID=529593`, `KHIPU_CHECKOUT_ENABLED=false`.
- Pendiente: guardar API key/llave del comercio, crear usuario de prueba con membresía y configurar su UUID permitido; interfaz demo y prueba integral.
- Verificación: RLS activo en las 12 tablas; RPCs de pagos denegados a `anon`/`authenticated`. Asesores sin advertencias/errores: cuatro avisos informativos por tablas internas con RLS y sin políticas (denegación intencional). Referencia: https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy
- Producción permanece en `bjdzivfwjxplbufqedko`; no aplicar allí los datos demo.

## Cuenta de desarrollo sin acceso al banco de la empresa

En Khipu: Perfil de usuario → Opciones de desarrollador → activar modo desarrollador → Configurar → Cuentas de cobro → Crear cuenta en modo desarrollador. Sus bancos son ficticios y no mueven dinero real. Luego obtener las credenciales de esa cuenta, no las de la empresa pendiente de activación.

Fuente: https://docs.khipu.com/payment-solutions/instant-payments/description

## Flujo implementado

1. `place-portal-order` admite `paymentMethod: "khipu"` solamente con el interruptor habilitado. El RPC existente calcula precios, IVA y reserva stock en una transacción. Reutilizar siempre `clientRequestId` ante reintentos.
2. `create-khipu-payment` recibe únicamente `{ "orderNumber": "OC-2026-001000" }`. Valida el JWT con `getUser`, el rol `pharmacy_user` y la membresía activa de compra. Ignora montos y URLs enviados por el cliente.
3. `claim_khipu_payment` bloquea el pedido y crea un registro único por pedido. El monto y vencimiento provienen de la base. Solicitudes simultáneas/repetidas no crean otro cobro.
4. Se llama a `POST https://payment-api.khipu.com/v3/payments` usando `x-api-key`. No se envían correos ni recordatorios. Se devuelve `paymentUrl` para la redirección futura del portal.
5. `khipu-webhook` comprueba HMAC SHA-256 sobre `timestamp.cuerpo_original`, en base64, con tolerancia de cinco minutos. Después consulta `GET /v3/payments/{id}` y exige receptor, moneda CLP, monto entero positivo, `status=done` y `status_detail=normal`.
6. El RPC de conciliación compara nuevamente la transacción, el ID del pago, receptor y monto con el registro y el pedido. Actualiza ambos atómicamente; las notificaciones duplicadas devuelven éxito sin repetir efectos.
7. La página `khipu-return.html` explica que volver del proveedor no acredita ni cancela el pago. El cliente consulta el estado persistido en sus pedidos.

La API key y el secreto del comercio para firmar webhooks son credenciales diferentes. No asumir que una reemplaza a la otra.

## Configuración (solo secretos del servidor)

| Variable | Valor/uso |
| --- | --- |
| `KHIPU_MODE` | `disabled` por defecto; `development` o `production` |
| `KHIPU_CHECKOUT_ENABLED` | `false` por defecto; solo `true` permite crear pedidos/cobros Khipu |
| `KHIPU_API_KEY` | API key de la cuenta elegida |
| `KHIPU_WEBHOOK_SECRET` | Secreto del comercio usado para verificar HMAC |
| `KHIPU_RECEIVER_ID` | ID de esa misma cuenta de cobro |
| `KHIPU_TEST_USER_IDS` | UUID de usuarios de prueba separados por comas; obligatorio para usar desarrollo |
| `KHIPU_PORTAL_ORIGIN` | Origen HTTPS, sin barra final; por defecto `https://portal.plofarma.cl` |

`SUPABASE_URL` y las claves del servidor son provistas por Supabase. Nunca poner secretos en HTML, JavaScript público, Git, URLs o mensajes. Los datos bancarios del pagador no se guardan en el registro de pagos.

**Usar un proyecto Supabase de pruebas y farmacias de prueba para desarrollo.** El banco ficticio confirma pedidos y puede enviarlos al flujo de bodega de ese proyecto; la lista de usuarios permitidos no transforma los pedidos en ficticios. Khipu usa el mismo servidor API para ambos ambientes, la cuenta de cobro determina el modo. No mezclar credenciales ni cambiar de receptor mientras hay pagos pendientes.

## Verificación local

Desde la raíz del repositorio (Deno 2 y Node 22):

```sh
deno test supabase/tests/khipu_test.ts
npm ci --prefix supabase/tests
npm test --prefix supabase/tests
deno check --lock=supabase/functions/deno.lock supabase/functions/create-khipu-payment/index.ts supabase/functions/khipu-webhook/index.ts supabase/functions/place-portal-order/index.ts supabase/functions/manage-portal-orders/index.ts
```

Las pruebas de SQL ejecutan las migraciones de catálogo, checkout, administración, comprobantes, bodega y Khipu en PostgreSQL embebido (PGlite), con tablas mínimas de identidad. Se ejecuta directamente la función de vencimiento; no se simula el scheduler pg_cron. Se prueban permisos como `service_role`, `anon` y `authenticated`. No reemplazan una prueba de concurrencia entre conexiones ni el flujo completo en Supabase/Khipu.

## Despliegue de pruebas pendiente

- Crear un proyecto de pruebas con el esquema previo, usuarios y catálogo de prueba.
- Revisar/aplicar la nueva migración mediante el flujo habitual; ejecutar los asesores de Supabase antes de publicar.
- Desplegar `place-portal-order`, `create-khipu-payment`, `khipu-webhook` y `manage-portal-orders` con sus módulos compartidos. `config.toml` desactiva la validación JWT de plataforma solo para los dos endpoints nuevos: el primero valida la sesión dentro del handler; el webhook autentica mediante la firma de Khipu.
- Publicar `khipu-return.html` y los rótulos de revisión del portal/admin en el entorno de pruebas.
- Configurar secretos de desarrollo y UUID permitidos; comprobar que una cuenta no permitida recibe rechazo.
- Crear el pedido con la API, crear el cobro y abrir `paymentUrl`. Completar el banco ficticio. Verificar firma real, cuenta, monto, actualización en pedidos y paso a bodega.
- Validar cancelación del navegador sin acreditar, expiración, respuesta perdida al crear y callbacks repetidos. Confirmar que los reintentos reales de Khipu usan una marca de tiempo compatible con la tolerancia configurada.

El frontend público no invoca aún el nuevo endpoint ni habilita la opción Khipu. Conectar esa opción y la redirección después de validar las credenciales y el circuito de pruebas; no basta con retirar `disabled` del botón.

## Casos que requieren revisión

- Si falla la creación o se pierde su respuesta, el registro queda `unknown` (o `creating` si murió el proceso). **No se repite POST automáticamente**, porque Khipu no documenta `transaction_id` como clave de idempotencia. Buscar el cobro en Khipu por esa referencia y conciliar antes de volver a permitir cualquier cobro. La firma válida y consulta posterior pueden recuperar un pago aunque aún no se haya guardado su ID.
- Un pago recibido con reserva vencida/cancelada pasa a `payment_review` y `payment_status=paid`. Se muestra como pago por revisar y no entra a bodega. No vuelve a descontar stock liberado. Si la reserva no había sido liberada, conserva ese stock para revisión. Resolver la disponibilidad o devolución con el operador: aún no existe una acción automática de resolución/reembolso.
- Volver por `cancel_url` no libera stock ni convierte el pago en fallido: Khipu permite retomar el pago. La reserva vence por el mecanismo existente o se cancela administrativamente; cualquier dinero posterior queda en revisión.
- Pagos marcados manualmente, anulaciones y devoluciones no autorizan despacho automático. La sincronización de devoluciones está fuera de esta entrega.
- Para pausar nuevos cobros, poner `KHIPU_CHECKOUT_ENABLED=false` y mantener credenciales/modo: los webhooks continúan conciliando pagos previos.

Consulta operativa (solo administrador de base):

```sql
select o.order_number, o.status as order_status, k.transaction_id,
       k.payment_id, k.status, k.review_reason, k.updated_at
from public.khipu_payments k join public.orders o on o.id = k.order_id
where k.status in ('unknown','review')
   or (k.status = 'creating' and k.created_at < now() - interval '2 minutes')
order by k.updated_at;
```

## Producción pendiente

Completar activación bancaria y contrato con un representante autorizado, obtener credenciales reales, terminar el checkout del portal, configurar monitoreo de casos inciertos/revisión, validar pruebas integrales y realizar un cobro real controlado antes de abrir a todos los clientes. No mover credenciales de desarrollo a producción ni activar producción como parte de las pruebas locales.

Referencias: [OpenAPI](https://docs.khipu.com/es/apis/v3/instant-payments/openapi), [webhooks](https://docs.khipu.com/es/payment-solutions/instant-payments/payment-webhook), [autenticación de Edge Functions](https://supabase.com/docs/guides/functions/auth).

## Prueba local preparada (2026-09-26)

Proyecto demo `ceyjjkasemmdtcpdsfly`: esquema y funciones desplegados. Secretos Khipu cargados por el usuario; checkout habilitado exclusivamente para el usuario de prueba `31af460f-8b0c-4130-a01d-c6dca9100196`, vinculado como comprador a la farmacia ficticia. Origen configurado: `http://localhost:8000`. El modo development admite este origen de loopback; production exige HTTPS.

Ejecutar desde la raíz del repositorio:

```sh
python3 -m http.server 8000 --bind 127.0.0.1 --directory supabase/demo/ui
```

Abrir http://localhost:8000 e iniciar sesión con el usuario demo. La página utiliza únicamente la clave pública del proyecto; la contraseña se ingresa directamente y no se guarda. El carrito contiene una unidad del producto ficticio 17, total $1.190 CLP. El retorno del proveedor abre la misma interfaz y consulta el estado del pedido mediante RLS. Falta completar el primer pago en DemoBank y verificar el webhook real; preparar el entorno no acredita esa prueba.

Validación local: 11 pruebas Deno aprobadas, pruebas SQL previas aprobadas. Los endpoints desplegados autentican en sus handlers (sesión de Supabase o firma Khipu), por lo que la verificación JWT de plataforma está desactivada.

### Primer pago integral confirmado

El 2026-09-26 a las 13:43:47 UTC se confirmó el pedido demo `OC-2026-001000`, $1.190 CLP. Tras completar DemoBank, la consulta de base verificó `orders.status=confirmed`, `orders.payment_status=paid`, `khipu_payments.status=paid`, `mode=development` y `review_reason=null`. El circuito de creación, pago ficticio y conciliación automática quedó validado para este caso exitoso. Siguen pendientes las pruebas integrales de cancelación/expiración y las condiciones de producción descritas arriba.

### Cancelación de navegación y vencimiento (2026-09-26)

- Se creó el cobro demo `OC-2026-001002` y se usó «VOLVER AL SITIO DE ORIGEN» en la pantalla de Khipu, sin transferencia. Retorno observado: `result=cancelled`. Se verifica el estado en base; volver no acredita ni cancela administrativamente la reserva.
- La función desplegada de vencimiento se probó en una transacción revertida con un pedido ficticio nuevo: reserva inicial de una unidad, vencimiento adelantado únicamente para ese pedido, estado cancelled/payment pending, stock restituido y segunda liberación sin duplicar stock. Todas las aserciones pasaron. Esto valida la función; no simula el vencimiento del cobro en el proveedor.
- El cron `release-expired-portal-orders` está activo cada cinco minutos.
- La interfaz local permite «Nueva prueba» únicamente después de consultar un pedido pagado o cancelado. No reinicia pedidos pendientes o cobros inciertos.

### Checkout del portal en demo

Disponible localmente en `http://localhost:8000/portal/` usando el mismo servidor de pruebas. Solo localhost/127.0.0.1:8000 seleccionan el proyecto demo y habilitan Khipu; los demás hosts conservan producción con el botón deshabilitado. El portal requiere iniciar sesión con el usuario demo. Incluye reserva con precios del servidor, redirección validada a Khipu, manejo de cobros inciertos sin crear otra orden y continuación del cobro desde Mis pedidos. El retorno explica que se debe consultar el estado en el portal; no acredita a partir del parámetro URL. No se ha publicado a producción. Validación: sintaxis JavaScript, diff sin errores y pantalla de acceso local. Pendiente: completar prueba autenticada del checkout integrado.

## Integración solicitada en portal.plofarma.cl

El dominio conserva el proyecto bjdzivfwjxplbufqedko y muestra Khipu demo. Migración aplicada y funciones place-portal-order, create-khipu-payment y khipu-webhook desplegadas. Cuenta de prueba: 789eccdf-f932-48fd-88b1-3ffb6833f4ec. Pendiente cargar credenciales demo en ese proyecto y verificar pago desde el dominio. La función administrativa existente no fue actualizada: revisión automática rechazó ese despliegue.
