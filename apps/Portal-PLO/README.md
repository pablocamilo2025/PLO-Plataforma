# PLO Droguería — Portal B2B

Portal B2B de liquidación farmacéutica para PLO Droguería. Acceso exclusivo para farmacias y distribuidores con resolución sanitaria vigente.

## Características MVP

- **Login real con Supabase Auth** mediante correo y contraseña definida por el cliente
- **Acceso solo por invitación**, recuperación de clave y sesión persistente
- **Consola de onboarding** en `/admin.html` para revisar preinscripciones y aprobar farmacias
- **Invitaciones desde una Edge Function protegida** por sesión y rol `portal_admin`
- **RLS por farmacia** para perfiles, membresías y sucursales
- **Tour de bienvenida** de 6 pasos al iniciar sesión
- **Catálogo** con 16 SKUs reales, filtros por categoría, búsqueda y ordenamiento
- **Precios por tier** (Oro −5%, Platino −10% adicional)
- **Ofertas relámpago** con countdown en vivo (−15% adicional)
- **Stock en tiempo real** con barras de nivel
- **Banner de referidos**: recomienda 3 farmacias → sube de nivel
- **Carrito** con barra de meta (envío gratis al superar $100.000 neto)
- **Historial de pedidos** con estados y barra de progreso
- Cliente `@supabase/supabase-js` fijado en la versión 2.117.1 y validado con SRI

## Autenticación y datos

El proyecto Supabase `PLO Farma` contiene:

- `preinscripciones`: registros públicos de la landing; solo permite `INSERT` anónimo.
- `pharmacies`: empresas aprobadas para ingresar al portal.
- `profiles`: datos visibles del usuario, sin credenciales.
- `pharmacy_memberships`: relación entre usuario, farmacia y rol.
- `branches`: sucursales visibles únicamente para miembros activos.

La función `manage-portal-invitations` es la única responsable de aprobar una
preinscripción y llamar a la API administrativa de Auth. Verifica el JWT del
operador y exige `app_metadata.role = portal_admin`; la clave secreta permanece
en el entorno de Supabase y nunca se entrega al navegador.

Al aprobar una solicitud se crean, dentro de una operación de base de datos, la
farmacia activa, el perfil, la membresía de propietario y la trazabilidad de la
invitación en `preinscripciones`.

Las credenciales se administran en Supabase Auth. PLO no crea, almacena ni puede leer las contraseñas de sus clientes. La clave secreta o `service_role` nunca debe incluirse en el navegador.

## Requisito antes de invitar clientes reales

Supabase exige un SMTP propio para entregar invitaciones a direcciones que no
pertenecen al equipo del proyecto. Configura un proveedor transaccional (por
ejemplo Resend) y un remitente del dominio `plofarma.cl` en Authentication →
Emails → SMTP Settings antes de usar **Aprobar e invitar** con farmacias reales.

## Deploy

Compatible con GitHub Pages, Netlify, Vercel o cualquier hosting estático.

### GitHub Pages
1. Settings → Pages
2. Branch: `main` / Folder: `/ (root)`
3. El portal queda en `https://retiniasur-hash.github.io/Portal-PLO/`

## Estado actual

La autenticación y el contexto de farmacia ya usan Supabase. El catálogo y los pedidos continúan como datos de demostración en el frontend y deben migrarse a tablas protegidas antes de operar con información comercial real.
