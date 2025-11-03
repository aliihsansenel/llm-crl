--- How many times vocabs and meanings used in RL items?
SELECT
  v.itself AS vocab_itself,
  m.itself AS meaning,
  (
    -- Count usage for each specific meaning
    SELECT
      COUNT(*)
    FROM
      public.rl_item_vocabs_and_meanings AS rl_usage
    WHERE
      rl_usage.meaning_id = m.id
  ) AS usage_count,
  m.id AS meaning_id
FROM
  public.meanings AS m
  -- Join to get the vocab word itself
  JOIN public.vocabs AS v ON m.vocab_id = v.id
  -- Join to get the list items
  JOIN public.p_vocab_list_items AS pvl_items ON v.id = pvl_items.vocab_id
  -- Join to get the list itself, filtered by owner
  JOIN public.p_vocab_lists AS pvl ON pvl_items.p_vocab_list_id = pvl.id
WHERE
  -- Filter for the specific user's vocab list
  pvl.owner_id = auth.uid ()
  -- Also filter for meanings owned by the user
  AND m.owner_id = auth.uid ()
ORDER BY
  -- Order by usage, with 0s at the top
  usage_count ASC;