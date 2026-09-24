alter table public.preinscripciones
  drop constraint preinscripciones_source_check;

alter table public.preinscripciones
  add constraint preinscripciones_source_check
  check (source in ('landing_plo', 'admin_manual'));

comment on column public.preinscripciones.source is
  'Origen de la solicitud: formulario público o invitación manual creada por un administrador.';
