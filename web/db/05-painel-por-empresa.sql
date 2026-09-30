-- O painel passa a receber empresa + departamento. As views ganham a coluna empresa
-- (view não aceita coluna nova no meio: é drop + create). A função antiga de dois
-- argumentos continua existindo, apontando para a LUBE, para nada no ar quebrar.
-- Aplicado em 2026-09-30.

drop view if exists financeiro.vw_pessoa_json;
drop view if exists financeiro.vw_rubricas_json;

create view financeiro.vw_rubricas_json as
select empresa, departamento, competencia, matricula,
       jsonb_agg(jsonb_build_object('codigo',codigo,'descricao',descricao,'tipo',tipo,
                                    'valor',valor,'referencia',referencia) order by ordem) as rubricas
from financeiro.fato_folha_rubrica
group by empresa, departamento, competencia, matricula;

create view financeiro.vw_pessoa_json as
select c.empresa, c.departamento, c.competencia, c.matricula, c.nome,
  jsonb_build_object('matricula',c.matricula,'nome',c.nome,'funcao',c.funcao,'admissao',c.admissao,
   'dep_ir',c.dep_ir,'dep_sf',c.dep_sf,'salario_contratual',c.salario_contratual,
   'proventos',c.total_proventos,'descontos',c.total_descontos,'liquido',c.liquido,'evento',c.evento,
   'bases',jsonb_build_object('inss',c.base_inss,'aliquota',c.aliquota_inss,'fgts',c.base_fgts,
                              'fgts_valor',c.valor_fgts,'irrf',c.base_irrf),
   'rubricas',coalesce(r.rubricas,'[]'::jsonb)) as j
from financeiro.fato_folha_colaborador c
left join financeiro.vw_rubricas_json r using (empresa, departamento, competencia, matricula);

create or replace function financeiro.painel_dados(p_emp text, p_dep text, p_comp date default null)
returns jsonb language sql stable security definer set search_path = financeiro, pg_temp as $$
with c as (
  select coalesce(p_comp,(select max(competencia) from fato_folha_colaborador where empresa=p_emp and departamento=p_dep)) as atual
), a as (
  select c.atual, (select max(competencia) from fato_folha_colaborador
                    where empresa=p_emp and departamento=p_dep and competencia < c.atual) as ant from c
), p as (
  select x.matricula, x.nome,
    x.j || jsonb_build_object(
      'anterior', y.j,
      'validacao', (select jsonb_build_object('status',v.status,'observacao',v.observacao,'atualizado_em',v.atualizado_em)
                      from validacao_folha v where v.empresa=p_emp and v.departamento=p_dep and v.competencia=a.atual and v.matricula=x.matricula),
      'correcoes', coalesce((select jsonb_agg(jsonb_build_object('codigo',k.codigo,'referencia',k.referencia,
                              'valor_original',k.valor_original,'valor_corrigido',k.valor_corrigido,'observacao',k.observacao))
                      from correcao_folha k where k.empresa=p_emp and k.departamento=p_dep and k.competencia=a.atual and k.matricula=x.matricula),'[]'::jsonb)
    ) as pessoa
  from a
  join vw_pessoa_json x on x.empresa=p_emp and x.departamento=p_dep and x.competencia=a.atual
  left join vw_pessoa_json y on y.empresa=p_emp and y.departamento=p_dep and y.competencia=a.ant and y.matricula=x.matricula
)
select jsonb_build_object(
 'empresa', p_emp,
 'razao_social', (select razao_social from empresa where sigla=p_emp),
 'departamento', p_dep,
 'competencia', (select atual from a),
 'competencia_anterior', (select ant from a),
 'competencias', coalesce((select jsonb_agg(distinct competencia) from fato_folha_colaborador where empresa=p_emp and departamento=p_dep),'[]'::jsonb),
 'gerado_em', now(),
 'beneficios', coalesce((select jsonb_agg(jsonb_build_object('codigo',codigo,'descricao',descricao,'tipo',tipo,'valor',valor) order by codigo)
                          from beneficio_referencia),'[]'::jsonb),
 'referencia_competencia', (select max(competencia) from referencia_desconto where competencia <= (select atual from a)),
 'referencias', coalesce((select jsonb_agg(jsonb_build_object('tipo',tipo,'nome',nome,'nome_busca',nome_busca,
                                   'valor',valor,'origem',origem,'setor',setor_origem) order by tipo, nome_busca)
                          from referencia_desconto
                          where competencia = (select max(competencia) from referencia_desconto
                                                where competencia <= (select atual from a))),'[]'::jsonb),
 -- todo mundo que tem folha nesta competência, em qualquer empresa: é contra esta lista que se
 -- descobre quem a planilha cobra e não está em folha nenhuma (a planilha LUBE-IMPÉRIO mistura as duas)
 'nomes_todas', coalesce((select jsonb_agg(jsonb_build_object('empresa',empresa,'departamento',departamento,'nome',nome))
                          from fato_folha_colaborador where competencia=(select atual from a)),'[]'::jsonb),
 'resumo', (select jsonb_build_object(
      'pessoas', count(*) filter (where competencia=(select atual from a)),
      'proventos', sum(total_proventos) filter (where competencia=(select atual from a)),
      'descontos', sum(total_descontos) filter (where competencia=(select atual from a)),
      'liquido', sum(liquido) filter (where competencia=(select atual from a)),
      'pessoas_anterior', count(*) filter (where competencia=(select ant from a)),
      'proventos_anterior', sum(total_proventos) filter (where competencia=(select ant from a)),
      'liquido_anterior', sum(liquido) filter (where competencia=(select ant from a)))
    from fato_folha_colaborador where empresa=p_emp and departamento=p_dep),
 'colaboradores', coalesce((select jsonb_agg(pessoa order by nome) from p),'[]'::jsonb));
$$;

-- compatibilidade: a chamada antiga (departamento, competência) é a LUBE
create or replace function financeiro.painel_dados(p_dep text default 'ADMINISTRATIVO', p_comp date default null)
returns jsonb language sql stable security definer set search_path = financeiro, pg_temp as $$
  select financeiro.painel_dados('LUBE', p_dep, p_comp);
$$;

revoke all on function financeiro.painel_dados(text, text, date) from anon, authenticated, public;
revoke all on function financeiro.painel_dados(text, date) from anon, authenticated, public;
