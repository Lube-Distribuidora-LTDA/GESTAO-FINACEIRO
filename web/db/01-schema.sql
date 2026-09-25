-- Sistema Financeiro da Lube — schema financeiro
-- Banco: Supabase, projeto DATA WAREHOUSE (ref ivcnotrynogaljrvvyes)
-- Aplicado em 2026-09-24. Não toca em compras, core nem stg_compras.

create schema if not exists financeiro;

-- Cabeçalho do recibo: um registro por colaborador por competência.
create table if not exists financeiro.fato_folha_colaborador (
  id                  bigint generated always as identity primary key,
  competencia         date        not null,
  departamento        text        not null,
  matricula           text        not null,
  nome                text        not null,
  funcao              text,
  admissao            date,
  salario_contratual  numeric(12,2),
  dep_ir              smallint    not null default 0,
  dep_sf              smallint    not null default 0,
  total_proventos     numeric(12,2),
  total_descontos     numeric(12,2),
  liquido             numeric(12,2),
  base_inss           numeric(12,2),
  aliquota_inss       text,
  base_fgts           numeric(12,2),
  valor_fgts          numeric(12,2),
  base_irrf           numeric(12,2),
  evento              text,   -- férias, atestado ou admissão: explica variação sem mudança de contrato
  carregado_em        timestamptz not null default now(),
  constraint uq_folha_colaborador unique (competencia, departamento, matricula)
);

-- Itens do recibo: proventos (P) e descontos (D).
create table if not exists financeiro.fato_folha_rubrica (
  id            bigint generated always as identity primary key,
  competencia   date        not null,
  departamento  text        not null,
  matricula     text        not null,
  codigo        text        not null,  -- 001 salário base, 667 empréstimo, 903 INSS...
  descricao     text        not null,
  tipo          char(1)     not null check (tipo in ('P','D')),
  valor         numeric(12,2) not null,
  referencia    text        not null default '', -- 227:20, Parc. 5/12, Dep.00001
  ordem         smallint,
  carregado_em  timestamptz not null default now()
);
create index if not exists ix_folha_rubrica_pessoa
  on financeiro.fato_folha_rubrica (departamento, matricula, competencia);

-- Tabela de benefícios: editável pela tela de configuração do painel.
create table if not exists financeiro.beneficio_referencia (
  codigo         text primary key,
  descricao      text not null,
  tipo           text not null check (tipo in ('fixo','unitario','percentual')),
  valor          numeric(12,4) not null,
  atualizado_em  timestamptz not null default now(),
  atualizado_por text
);

-- Decisão do Júlio sobre cada pessoa naquela competência.
create table if not exists financeiro.validacao_folha (
  competencia   date not null,
  departamento  text not null,
  matricula     text not null,
  status        text not null check (status in ('confirmado','verificar','corrigido')),
  observacao    text,
  usuario       text,
  atualizado_em timestamptz not null default now(),
  primary key (competencia, departamento, matricula)
);

-- Valor corrigido à mão. O original fica ao lado: nada é sobrescrito em silêncio.
create table if not exists financeiro.correcao_folha (
  id              bigint generated always as identity primary key,
  competencia     date not null,
  departamento    text not null,
  matricula       text not null,
  codigo          text not null,
  referencia      text not null default '',
  valor_original  numeric(12,2),
  valor_corrigido numeric(12,2) not null,
  observacao      text,
  usuario         text,
  atualizado_em   timestamptz not null default now(),
  constraint uq_correcao unique (competencia, departamento, matricula, codigo, referencia)
);

-- "A carga entrou?" se responde aqui, nunca de memória.
create table if not exists financeiro.controle_carga (
  id               bigint generated always as identity primary key,
  consulta         text not null,
  destino          text,
  linhas           integer,
  linhas_esperadas integer,
  status           text not null,
  mensagem         text,
  duracao_ms       integer,
  executado_em     timestamptz not null default now()
);

-- RLS ligado e sem políticas: a chave pública não lê nem escreve nada.
-- Quem acessa é a função serverless, com usuário do banco.
alter table financeiro.fato_folha_colaborador enable row level security;
alter table financeiro.fato_folha_rubrica     enable row level security;
alter table financeiro.beneficio_referencia   enable row level security;
alter table financeiro.validacao_folha        enable row level security;
alter table financeiro.correcao_folha         enable row level security;
alter table financeiro.controle_carga         enable row level security;

revoke all on schema financeiro from anon, authenticated;
revoke all on all tables in schema financeiro from anon, authenticated;
