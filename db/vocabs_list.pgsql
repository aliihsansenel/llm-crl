select
  v.id,
  v.itself,
  v.created_at,
  (pli.vocab_id is not null) as is_in_user_list
from
  vocabs v
  left join p_vocab_list_items pli on v.id = pli.vocab_id
  and pli.p_vocab_list_id = (
    select
      id
    from
      p_vocab_lists
    where
      owner_id = auth.uid ()
    limit
      1
  )
order by
  created_at desc
limit
  20
offset
  20;