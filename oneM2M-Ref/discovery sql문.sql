# discovery for ty, cra, lim of filter creteria
select a.*
from (
      select ri, ty
      from lookup
      where (ri = '/mobius' or ri like '/mobius/%') and ty = '4'
      order by ri desc limit 10000 
) b left join lookup as a on b.ri = a.ri where a.ct > '20150609' limit 10;

# discovery for ty, cra, lim of filter creteria
select a.*
from (
      select ri, ty
      from lookup
      where (ri ='/mobius/c067/s' or ri like '/mobius/c067/s/%') and ty = '4'
      order by ri desc limit 10000 
) b left join lookup as a on b.ri = a.ri where a.ct > '20150609' limit 10;

# discovery for ty, cra, lim of filter creteria
select a.*
from (
      select ri, ty
      from lookup
      where (ri = '/mobius' or ri like '/mobius/%') and ty = '3'
      order by ri desc limit 10000 
) b left join lookup as a on b.ri = a.ri where a.ct > '20150609' limit 100;

# discovery for ty, lim of filter creteria
select a.*
from (
      select ri, ty
      from lookup
      where (ri = '/mobius' or ri like '/mobius/%') and ty = '2'
      order by ri desc limit 10000 
) b left join lookup as a on b.ri = a.ri order by ri desc limit 100;

# discovery for lim of filter creteria
select a.*
from (
      select ri, ty
      from lookup
      where (ri = '/mobius' or ri like '/mobius/%')
      order by ri desc limit 10000 
) b left join lookup as a on b.ri = a.ri order by ri desc limit 10;

# discovery for cra of filter creteria
select a.*
from (
      select ri, ty
      from lookup
      where (ri = '/mobius' or ri like '/mobius/%')
      order by ri desc limit 10000 
) b left join lookup as a on b.ri = a.ri where a.ct > '20150609' order by ri desc limit 1000;


# discovery for cra, lim of filter creteria
select a.*
from (
      select ri, ty
      from lookup
      where (ri = '/mobius' or ri like '/mobius/%')
      order by ri desc limit 10000 
) b left join lookup as a on b.ri = a.ri where a.ct > '20150609' limit 10;

