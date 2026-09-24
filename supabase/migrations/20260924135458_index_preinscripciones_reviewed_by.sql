create index preinscripciones_reviewed_by_idx
  on public.preinscripciones(reviewed_by)
  where reviewed_by is not null;
