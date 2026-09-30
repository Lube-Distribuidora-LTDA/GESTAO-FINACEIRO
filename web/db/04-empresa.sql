-- A folha deixa de ser só da LUBE Distribuidora: entram SERMAR, IMPÉRIO LOG, L LOG e
-- LUBE RIO, cada uma com seus departamentos. A matrícula se repete entre empresas
-- (000034 existe na SERMAR e na LUBE), então "empresa" entra em toda chave.
-- Nada é apagado: a coluna nasce com default 'LUBE' e o que já está gravado continua válido.
-- Aplicado em 2026-09-30.

alter table financeiro.fato_folha_colaborador add column if not exists empresa text not null default 'LUBE';
alter table financeiro.fato_folha_rubrica     add column if not exists empresa text not null default 'LUBE';
alter table financeiro.validacao_folha        add column if not exists empresa text not null default 'LUBE';
alter table financeiro.correcao_folha         add column if not exists empresa text not null default 'LUBE';

alter table financeiro.fato_folha_colaborador drop constraint if exists uq_folha_colaborador;
alter table financeiro.fato_folha_colaborador add constraint uq_folha_colaborador
  unique (competencia, empresa, departamento, matricula);

drop index if exists financeiro.ix_folha_rubrica_pessoa;
create index if not exists ix_folha_rubrica_pessoa
  on financeiro.fato_folha_rubrica (empresa, departamento, matricula, competencia);

alter table financeiro.validacao_folha drop constraint if exists validacao_folha_pkey;
alter table financeiro.validacao_folha add primary key (competencia, empresa, departamento, matricula);

alter table financeiro.correcao_folha drop constraint if exists uq_correcao;
alter table financeiro.correcao_folha add constraint uq_correcao
  unique (competencia, empresa, departamento, matricula, codigo, referencia);

-- Cadastro das empresas como aparecem no cabeçalho do PDF do DP.
create table if not exists financeiro.empresa (
  sigla        text primary key,          -- LUBE, LUBE RJ, LLOG, IMPERIO, SERMAR
  codigo_dp    text not null unique,      -- 00001, 00015, 00008, 00010, 00004
  razao_social text not null,
  ordem        smallint not null default 0
);
insert into financeiro.empresa (sigla, codigo_dp, razao_social, ordem) values
  ('LUBE',    '00001', 'LUBE DISTRIBUIDORA LTDA', 1),
  ('LUBE RJ', '00015', 'LUBE RIO DISTRIBUIDORA LTDA', 2),
  ('LLOG',    '00008', 'L LOG TRANSPORTES E SERVIÇOS LTDA', 3),
  ('IMPERIO', '00010', 'IMPERIO LOG LTDA', 4),
  ('SERMAR',  '00004', 'SERMAR INCORPORAÇÕES E LOCAÇÕES IMOBILIARIAS LTDA', 5)
on conflict (sigla) do nothing;
alter table financeiro.empresa enable row level security;
revoke all on financeiro.empresa from anon, authenticated;

-- O menu do painel mostra só o que existe: empresas e departamentos com folha carregada.
create or replace function financeiro.painel_departamentos()
returns jsonb language sql stable security definer set search_path = financeiro, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'empresa', e.sigla, 'razao_social', e.razao_social, 'ordem', e.ordem,
           'departamentos', d.deps) order by e.ordem), '[]'::jsonb)
  from empresa e
  join lateral (
    select jsonb_agg(jsonb_build_object('departamento', x.departamento, 'pessoas', x.pessoas,
                                        'competencias', x.comps) order by x.departamento) as deps
    from (
      select departamento,
             count(*) filter (where competencia = (select max(competencia) from fato_folha_colaborador f2
                                                    where f2.empresa = f.empresa and f2.departamento = f.departamento)) as pessoas,
             jsonb_agg(distinct competencia) as comps
      from fato_folha_colaborador f
      where f.empresa = e.sigla
      group by departamento
    ) x
  ) d on d.deps is not null;
$$;
revoke all on function financeiro.painel_departamentos() from anon, authenticated, public;
