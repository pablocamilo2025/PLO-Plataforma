# Portal de Atención PLO

## Estado: recepción y herramientas de atención (30 septiembre 2026)

`inbox.html` es la nueva bandeja. `index.html` conserva el prototipo simulado anterior y enlaza a la nueva versión. No se desplegó esta entrega ni se modificó una base remota. PLO todavía no ha definido el número.

Incluye acceso con cuenta `portal_admin`, conversaciones paginadas (50 por página), búsqueda y filtros locales por página, últimos 100 mensajes recibidos, resolución/reapertura de casos y estados vacíos/errores explícitos. Las consultas pasan por una Edge Function que valida el usuario con `getUser`; no existe acceso directo a tablas desde el navegador. La sesión del portal de atención usa su propio storageKey.

La recepción valida el challenge y la firma HMAC SHA-256 del cuerpo original de Meta, restringe el ID de número configurado, guarda cada mensaje una sola vez y devuelve error reintentable si falla la persistencia. Un mensaje posterior reabre el caso. Los tipos multimedia se conservan como indicadores de contenido pendiente, sin descargar archivos. Las notificaciones de estado se ignoran porque aún no hay envíos.

### Prueba local sin WhatsApp

Desde la raíz de PLO-Plataforma:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
node --test supabase/tests/whatsapp*.test.mjs
```

Abrir `http://127.0.0.1:8000/apps/Portalwhatsapp/inbox.html?demo=1`. La demostración solo se activa en localhost, contiene dos contactos ficticios y guarda los cambios únicamente en memoria. No envía mensajes. Sin `demo=1` se presenta el acceso administrador.

### Activación pendiente

1. Definir el número de PLO y configurar WhatsApp Business Platform en la cuenta Meta del negocio.
2. Revisar/aplicar, en orden, las migraciones `20260930153526_whatsapp_inbox.sql` , `20260930154439_whatsapp_case_tools.sql` y `20260930160011_whatsapp_customer_context.sql` en un entorno de prueba, ejecutar asesores y desplegar `whatsapp-webhook` y `whatsapp-inbox`. La configuración local desactiva el JWT de plataforma para ambos; sus handlers autentican mediante firma Meta o getUser, respectivamente.
3. Configurar solo en servidor: `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`. Las funciones utilizan las variables de Supabase existentes `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`. Nunca copiar secretos al frontend.
4. Registrar `https://<proyecto>.supabase.co/functions/v1/whatsapp-webhook` en Meta y suscribirse a mensajes. El token de verificación debe coincidir con el configurado en el servidor.
5. Verificar con un mensaje entrante de prueba: firma válida, una fila por mensaje, duplicados sin efectos, acceso administrador y rechazo de usuario de farmacia. Probar resolución seguida de un nuevo mensaje.
6. Ajustar el proyecto público de `inbox.js` si se prueba en otro entorno. Los orígenes permitidos del endpoint son portal.plofarma.cl y localhost:8000. Publicar solo después de la validación integral.

### Segunda entrega implementada localmente

- Borradores personales por conversación y administrador, guardados en servidor al desplegar. Control de revisión para impedir sobrescritura desde otra ventana. Cambios sin guardar se conservan en memoria al cambiar de caso y se avisa al salir de la página.
- Respuestas rápidas editables (saludo, consulta de pedido y revisión), que solo completan el borrador. No son plantillas aprobadas por Meta.
- Notas internas del equipo, máximo 2000 caracteres y últimas 50 visibles. El identificador de solicitud evita duplicados ante reintentos.
- Búsqueda de farmacias activas (máximo 20 resultados), vinculación/desvinculación manual con control del vínculo anterior y auditoría del administrador. No se infiere identidad por teléfono.
- Contexto de últimos cinco pedidos de la farmacia vinculada: número, monto, estado y pago. La tercera entrega agrega la selección sincronizada descrita abajo.
- API extraída a handler comprobable. Siete pruebas automatizadas aprobadas: firma, duplicados, persistencia, aislamiento, autorización, revisiones y auditoría. Pruebas visuales locales de borrador, nota y vinculación con pedido ficticio completadas.

Las tres tablas nuevas tienen RLS activado y acceso directo revocado a clientes; solo las funciones de servidor, tras validar al administrador, pueden leerlas. El borrador se filtra por el ID del usuario autenticado. La demostración mantiene cambios en memoria y no inicializa el cliente Supabase. Al recargar se reinicia.

### Tercera entrega: identidad y compra

- Registro de múltiples contactos autorizados por farmacia, nombre y teléfono internacional normalizado. Requiere confirmación explícita del administrador; no copia automáticamente el teléfono editable de un perfil. Permite desactivar contactos.
- Al recibir un mensaje o abrir su ficha, coincidencia única con un contacto activo de farmacia activa: vinculación automática. Sin coincidencia: pendiente de vincular; varias farmacias: revisión manual. Las decisiones manuales, incluida desvinculación, prevalecen. Desactivar contactos invalida vinculaciones automáticas en la siguiente consulta/recepción.
- El historial corresponde a la farmacia vinculada. No atribuye todos los pedidos a una persona específica por su teléfono.
- El Portal B2B comparte SKU y cantidades al cambiar el carrito, tras confirmar el pedido (vacío) y cada 30 segundos mientras la pestaña está visible. Usa una sesión de carrito por pestaña, validación de datos en servidor, timestamp del servidor y RLS por usuario con membresía, perfil y farmacia activos. No reserva stock, no crea pedidos y no envía precios proporcionados por el navegador.
- El carrito del comprador se conserva localmente por cuenta y farmacia; al iniciar se restaura ajustado al catálogo/stock disponible. Las escrituras se serializan; una falla de sincronización no bloquea la compra y se señala en el carrito.
- Atención consulta hasta 10 sesiones de las últimas 24 horas. Muestra cantidades, nombres del catálogo y hora; después de 90 segundos se rotula como última selección conocida. La ficha se consulta al abrirla o con **Actualizar ficha**; aún no tiene suscripción Realtime. Los precios finales se consultan en pedidos, no se estiman en el carrito de atención.
- Diez pruebas automatizadas: normalización, coincidencias únicas/ambiguas/inactivas, prioridad manual, aislamiento por usuario/farmacia, sesiones separadas, payload inválido y orden de escrituras, además de las pruebas anteriores. Demostración visual comprobada de identificación y retiro al desactivar el contacto.

Despliegue pendiente: aplicar las tres migraciones en entorno de prueba, ejecutar asesores de Supabase y probar dos sesiones reales (cliente/administrador) antes de publicar. El frontend B2B y `cart-context.mjs` deben desplegarse juntos. Acordar retención y limpieza de snapshots antes de activar uso sostenido; el filtro de 24 horas limita la vista, no elimina registros. No hubo cambios a bases remotas ni envío de WhatsApp.

### Próximas entregas

- Envío de respuestas, estados de entrega y manejo de ventana de atención.
- Actualización automática de la ficha de atención, roles de atención con permisos específicos y asignación de agentes.
- Adjuntos, historial anterior a los últimos 100 mensajes y filtros globales.
- Plantillas aprobadas, consentimiento, campañas y métricas reales de atención.

No confundir resolver un caso con responder al cliente: esta entrega solo recibe mensajes. No calcula tiempos de respuesta ni simula envíos. El cambio de estado usa el último mensaje esperado para evitar resolver una conversación si llega un mensaje nuevo durante la operación. Falta prueba de concurrencia con conexiones independientes y ensayo en infraestructura Supabase/Meta.

Referencias consultadas: [webhooks Meta](https://whatsapp.github.io/WhatsApp-Nodejs-SDK/api-reference/webhooks/start/) y [getUser Supabase](https://supabase.com/docs/reference/javascript/auth-getuser).

## Dominio de soporte

La configuración de Vercel enruta soporte.plofarma.cl a inbox.html y sus recursos. Agregar el dominio al proyecto Vercel y configurar el DNS indicado por Vercel. La API permite el origen https://soporte.plofarma.cl. El push no configura DNS ni aplica migraciones. Ejecutar las migraciones y desplegar funciones antes de la validación integrada.
