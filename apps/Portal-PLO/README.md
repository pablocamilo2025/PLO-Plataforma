# PLO Droguería — Portal B2B

Portal B2B de liquidación farmacéutica para PLO Droguería. Acceso exclusivo para farmacias y distribuidores con resolución sanitaria vigente.

## Características MVP

- **Login simulado** con 3 accesos de demostración (Platino / Oro / Estándar)
- **Tour de bienvenida** de 6 pasos al iniciar sesión
- **Catálogo** con 16 SKUs reales, filtros por categoría, búsqueda y ordenamiento
- **Precios por tier** (Oro −5%, Platino −10% adicional)
- **Ofertas relámpago** con countdown en vivo (−15% adicional)
- **Stock en tiempo real** con barras de nivel
- **Banner de referidos**: recomienda 3 farmacias → sube de nivel
- **Carrito** con barra de meta (envío gratis al superar $100.000 neto)
- **Historial de pedidos** con estados y barra de progreso
- Sin dependencias externas (solo Google Fonts)

## Deploy

Compatible con GitHub Pages, Netlify, Vercel o cualquier hosting estático.

### GitHub Pages
1. Settings → Pages
2. Branch: `main` / Folder: `/ (root)`
3. El portal queda en `https://retiniasur-hash.github.io/Portal-PLO/`

## Notas

> MVP de validación — login simulado, sin backend real ni base de datos persistente.  
> La producción (auth real, base de datos, SII/DTE) se cotiza como Fase 2.
