-- Referência de desconto por pessoa: o que as operadoras cobram de cada um e
-- a lista de vales do mês. É contra isto que a folha é conferida.
-- Fonte: planilhas das filiais (LUBE, LUBE RJ, LLOG, IMPERIO, SERMAR) + lista de vales.
-- Aplicado em 2026-09-30.
create table if not exists financeiro.referencia_desconto (
  id            bigint generated always as identity primary key,
  competencia   date not null,
  tipo          text not null check (tipo in ('odonto_titular','odonto_dependente',
                                              'saude_titular','saude_dependente','vale')),
  nome          text not null,   -- como está escrito na planilha
  nome_busca    text not null,   -- sem acento, maiúsculo: é por aqui que o painel casa com a folha
  valor         numeric(12,2) not null,
  origem        text not null,   -- planilha de onde veio
  setor_origem  text,            -- ADM, ENTREGA, VENDAS... define de qual folha a pessoa é
  observacao    text,
  carregado_em  timestamptz not null default now(),
  constraint uq_referencia unique (competencia, tipo, nome_busca)
);

alter table financeiro.referencia_desconto enable row level security;
revoke all on financeiro.referencia_desconto from anon, authenticated;
