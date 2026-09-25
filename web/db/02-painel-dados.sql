-- Todo o conteúdo do painel sai de uma função só, que devolve JSON.
-- A função serverless (/api/dados) é apenas encanamento.

-- Rubricas de cada pessoa/competência já agregadas em JSON.
create or replace view financeiro.vw_rubricas_json as
select departamento, competencia, matricula,
       jsonb_agg(jsonb_build_object('codigo',codigo,'descricao',descricao,'tipo',tipo,
                                    'valor',valor,'referencia',referencia) order by ordem) as rubricas
from financeiro.fato_folha_rubrica
group by departamento, competencia, matricula;

-- Um objeto JSON por pessoa/competência: cadastro, totais, bases e rubricas.
create or replace view financeiro.vw_pessoa_json as
select c.departamento, c.competencia, c.matricula, c.nome,
  jsonb_build_object('matricula',c.matricula,'nome',c.nome,'funcao',c.funcao,'admissao',c.admissao,
   'dep_ir',c.dep_ir,'dep_sf',c.dep_sf,'salario_contratual',c.salario_contratual,
   'proventos',c.total_proventos,'descontos',c.total_descontos,'liquido',c.liquido,'evento',c.evento,
   'bases',jsonb_build_object('inss',c.base_inss,'aliquota',c.aliquota_inss,'fgts',c.base_fgts,
                              'fgts_valor',c.valor_fgts,'irrf',c.base_irrf),
   'rubricas',coalesce(r.rubricas,'[]'::jsonb)) as j
from financeiro.fato_folha_colaborador c
left join financeiro.vw_rubricas_json r using (departamento, competencia, matricula);

-- Payload do painel: competência atual + a anterior lado a lado, por pessoa.
-- Sem p_comp, usa a competência mais recente daquele departamento.
create or replace function financeiro.painel_dados(p_dep text default 'ADMINISTRATIVO', p_comp date default null)
returns jsonb language sql stable security definer set search_path = financeiro, pg_temp as $$
with c as (
  select coalesce(p_comp,(select max(competencia) from fato_folha_colaborador where departamento=p_dep)) as atual
), a as (
  select c.atual, (select max(competencia) from fato_folha_colaborador
                    where departamento=p_dep and competencia < c.atual) as ant from c
), p as (
  select x.matricula, x.nome,
    x.j || jsonb_build_object(
      'anterior', y.j,
      'validacao', (select jsonb_build_object('status',v.status,'observacao',v.observacao,'atualizado_em',v.atualizado_em)
                      from validacao_folha v where v.departamento=p_dep and v.competencia=a.atual and v.matricula=x.matricula),
      'correcoes', coalesce((select jsonb_agg(jsonb_build_object('codigo',k.codigo,'referencia',k.referencia,
                              'valor_original',k.valor_original,'valor_corrigido',k.valor_corrigido,'observacao',k.observacao))
                      from correcao_folha k where k.departamento=p_dep and k.competencia=a.atual and k.matricula=x.matricula),'[]'::jsonb)
    ) as pessoa
  from a
  join vw_pessoa_json x on x.departamento=p_dep and x.competencia=a.atual
  left join vw_pessoa_json y on y.departamento=p_dep and y.competencia=a.ant and y.matricula=x.matricula
)
select jsonb_build_object(
 'departamento', p_dep,
 'competencia', (select atual from a),
 'competencia_anterior', (select ant from a),
 'gerado_em', now(),
 'beneficios', coalesce((select jsonb_agg(jsonb_build_object('codigo',codigo,'descricao',descricao,'tipo',tipo,'valor',valor) order by codigo)
                          from beneficio_referencia),'[]'::jsonb),
 'resumo', (select jsonb_build_object(
      'pessoas', count(*) filter (where competencia=(select atual from a)),
      'proventos', sum(total_proventos) filter (where competencia=(select atual from a)),
      'descontos', sum(total_descontos) filter (where competencia=(select atual from a)),
      'liquido', sum(liquido) filter (where competencia=(select atual from a)),
      'pessoas_anterior', count(*) filter (where competencia=(select ant from a)),
      'proventos_anterior', sum(total_proventos) filter (where competencia=(select ant from a)),
      'liquido_anterior', sum(liquido) filter (where competencia=(select ant from a)))
    from fato_folha_colaborador where departamento=p_dep),
 'colaboradores', coalesce((select jsonb_agg(pessoa order by nome) from p),'[]'::jsonb));
$$;

revoke all on function financeiro.painel_dados(text, date) from anon, authenticated, public;
