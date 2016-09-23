
select a.*
from (
      select ri
      from lookup
      where (pi = '/mobius/c067/s')
      order by ri asc limit 10000
) b left join lookup as a on b.ri = a.ri where (ty = '4' or ty = '25') limit 1
