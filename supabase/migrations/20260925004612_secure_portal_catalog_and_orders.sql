create table public.catalog_items (
  id bigint generated always as identity primary key,
  sku text not null unique,
  name text not null,
  laboratory text not null,
  category text not null,
  lot_code text not null,
  expires_on date not null,
  net_price integer not null,
  reference_price integer not null,
  stock integer not null default 0,
  max_order_quantity integer not null,
  is_flash boolean not null default false,
  is_max_liquidation boolean not null default false,
  image_path text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint catalog_items_sku_format check (sku ~ '^PLO-[0-9]{4}$'),
  constraint catalog_items_name_length check (char_length(trim(name)) between 2 and 180),
  constraint catalog_items_laboratory_length check (char_length(trim(laboratory)) between 2 and 120),
  constraint catalog_items_category_length check (char_length(trim(category)) between 2 and 80),
  constraint catalog_items_lot_code_length check (char_length(trim(lot_code)) between 1 and 60),
  constraint catalog_items_net_price_positive check (net_price > 0),
  constraint catalog_items_reference_price_valid check (reference_price >= net_price),
  constraint catalog_items_stock_nonnegative check (stock >= 0),
  constraint catalog_items_max_quantity_positive check (max_order_quantity > 0),
  constraint catalog_items_image_path_safe check (
    image_path is null or image_path ~ '^images/[A-Za-z0-9._/-]+$'
  )
);

comment on table public.catalog_items is
  'Catálogo privado del Portal PLO. Cada fila representa un producto y lote disponible para clientes activos.';
comment on column public.catalog_items.net_price is 'Precio neto base en pesos chilenos, sin decimales.';
comment on column public.catalog_items.reference_price is 'Precio de venta público de referencia en pesos chilenos.';

create index catalog_items_active_category_idx
  on public.catalog_items (category, name)
  where is_active is true;

create table public.orders (
  id bigint generated always as identity primary key,
  order_number text not null unique,
  pharmacy_id uuid not null references public.pharmacies(id) on delete restrict,
  placed_by uuid not null references auth.users(id) on delete restrict,
  status text not null default 'submitted',
  payment_status text not null default 'pending',
  payment_method text not null,
  payment_reference text,
  net_total integer not null,
  tax_total integer not null,
  grand_total integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orders_number_length check (char_length(trim(order_number)) between 6 and 40),
  constraint orders_status_valid check (
    status in ('submitted', 'confirmed', 'preparing', 'in_transit', 'delivered', 'cancelled')
  ),
  constraint orders_payment_status_valid check (
    payment_status in ('pending', 'paid', 'failed', 'refunded')
  ),
  constraint orders_payment_method_valid check (
    payment_method in ('cash', 'bank_transfer', 'khipu')
  ),
  constraint orders_totals_nonnegative check (
    net_total >= 0 and tax_total >= 0 and grand_total >= 0
  ),
  constraint orders_total_consistent check (grand_total = net_total + tax_total)
);

comment on table public.orders is
  'Cabecera de pedidos del Portal PLO, aislada por farmacia mediante RLS.';

create index orders_pharmacy_created_at_idx
  on public.orders (pharmacy_id, created_at desc);
create index orders_placed_by_idx on public.orders (placed_by);

create table public.order_items (
  id bigint generated always as identity primary key,
  order_id bigint not null references public.orders(id) on delete cascade,
  catalog_item_id bigint not null references public.catalog_items(id) on delete restrict,
  sku text not null,
  product_name text not null,
  laboratory text not null,
  lot_code text not null,
  unit_net_price integer not null,
  quantity integer not null,
  line_net_total integer generated always as (unit_net_price * quantity) stored,
  created_at timestamptz not null default now(),
  constraint order_items_order_catalog_unique unique (order_id, catalog_item_id),
  constraint order_items_unit_price_positive check (unit_net_price > 0),
  constraint order_items_quantity_positive check (quantity > 0),
  constraint order_items_product_name_length check (char_length(trim(product_name)) between 2 and 180)
);

comment on table public.order_items is
  'Detalle inmutable del pedido con datos y precio del producto al momento de comprar.';

create index order_items_catalog_item_id_idx on public.order_items (catalog_item_id);

alter table public.catalog_items enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;

create policy catalog_items_select_active_clients
on public.catalog_items
for select
to authenticated
using (
  is_active is true
  and exists (
    select 1
    from public.pharmacy_memberships membership
    join public.pharmacies pharmacy on pharmacy.id = membership.pharmacy_id
    join public.profiles profile on profile.user_id = membership.user_id
    where membership.user_id = (select auth.uid())
      and membership.status = 'active'
      and pharmacy.status = 'active'
      and profile.status = 'active'
  )
);

create policy orders_select_own_pharmacy
on public.orders
for select
to authenticated
using (
  exists (
    select 1
    from public.pharmacy_memberships membership
    join public.pharmacies pharmacy on pharmacy.id = membership.pharmacy_id
    join public.profiles profile on profile.user_id = membership.user_id
    where membership.pharmacy_id = orders.pharmacy_id
      and membership.user_id = (select auth.uid())
      and membership.status = 'active'
      and pharmacy.status = 'active'
      and profile.status = 'active'
  )
);

create policy order_items_select_own_pharmacy
on public.order_items
for select
to authenticated
using (
  exists (
    select 1
    from public.orders portal_order
    join public.pharmacy_memberships membership
      on membership.pharmacy_id = portal_order.pharmacy_id
    join public.pharmacies pharmacy on pharmacy.id = membership.pharmacy_id
    join public.profiles profile on profile.user_id = membership.user_id
    where portal_order.id = order_items.order_id
      and membership.user_id = (select auth.uid())
      and membership.status = 'active'
      and pharmacy.status = 'active'
      and profile.status = 'active'
  )
);

revoke all on table public.catalog_items from anon, authenticated;
revoke all on table public.orders from anon, authenticated;
revoke all on table public.order_items from anon, authenticated;
grant select on table public.catalog_items to authenticated;
grant select on table public.orders to authenticated;
grant select on table public.order_items to authenticated;

insert into public.catalog_items (
  sku, name, laboratory, category, lot_code, expires_on, net_price,
  reference_price, stock, max_order_quantity, is_flash,
  is_max_liquidation, image_path
) values
  ('PLO-0142', 'Losartán 50 mg ×30 comp.', 'Lab. Chile', 'Cardiovascular', 'L-24891', '2026-11-30', 1890, 6490, 38, 120, true,  true,  'images/losartan-50mg.jpg'),
  ('PLO-0077', 'Metformina 850 mg ×60 comp.', 'Lab. Chile', 'Diabetes', 'M-77012', '2027-02-28', 2150, 7290, 210, 300, false, false, 'images/metformina-850mg.jpg'),
  ('PLO-0203', 'Atorvastatina 20 mg ×30 comp.', 'Lab. Chile', 'Cardiovascular', 'A-55340', '2026-10-15', 2490, 9990, 64, 200, false, true,  'images/atorvastatina-20mg.jpg'),
  ('PLO-0318', 'Omeprazol 20 mg ×30 cáps.', 'Mintlab', 'Gastro', 'O-11207', '2027-01-31', 990, 4590, 420, 500, false, false, null),
  ('PLO-0095', 'Paracetamol 500 mg ×100 comp.', 'Lab. Chile', 'Analgésicos', 'P-88431', '2027-05-31', 1290, 3990, 530, 600, false, false, null),
  ('PLO-0261', 'Ibuprofeno 400 mg ×50 comp.', 'Pasteur', 'Analgésicos', 'I-40987', '2026-12-31', 1450, 4890, 96, 250, false, false, null),
  ('PLO-0410', 'Salbutamol inhalador 100 mcg', 'GSK', 'Respiratorio', 'S-20915', '2026-09-30', 3290, 8990, 22, 80, true, false, null),
  ('PLO-0356', 'Loratadina 10 mg ×30 comp.', 'Mintlab', 'Respiratorio', 'LT-6644', '2027-03-31', 890, 3490, 310, 400, false, false, null),
  ('PLO-0188', 'Sertralina 50 mg ×30 comp.', 'Saval', 'SNC', 'SE-3321', '2026-12-15', 2790, 11990, 48, 150, false, false, null),
  ('PLO-0522', 'Amoxicilina 500 mg ×21 cáps.', 'Lab. Andrómaco', 'Antibióticos', 'AX-9910', '2026-10-31', 1990, 6290, 75, 180, false, false, null),
  ('PLO-0467', 'Azitromicina 500 mg ×3 comp.', 'Pasteur', 'Antibióticos', 'AZ-1276', '2026-11-15', 1690, 5990, 19, 100, true, true, null),
  ('PLO-0290', 'Enalapril 10 mg ×30 comp.', 'Lab. Chile', 'Cardiovascular', 'E-50213', '2027-04-30', 1090, 4290, 260, 320, false, false, null),
  ('PLO-0611', 'Clonazepam 0,5 mg ×30 comp.*', 'Saval', 'SNC', 'CL-8804', '2026-12-20', 1590, 5490, 33, 90, false, false, null),
  ('PLO-0344', 'Vitamina D3 1000 UI ×60 cáps.', 'Knop', 'Suplementos', 'VD-2210', '2027-06-30', 2290, 8490, 140, 200, false, false, null),
  ('PLO-0578', 'Insulina glargina 100 U/ml', 'Sanofi', 'Diabetes', 'IG-0034', '2026-09-15', 8990, 24990, 12, 60, false, false, null),
  ('PLO-0429', 'Prednisona 20 mg ×20 comp.', 'Mintlab', 'Corticoides', 'PR-7182', '2026-11-30', 1190, 4190, 88, 160, false, false, null);
