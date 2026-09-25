# GESTÃO FINANCEIRO — Lube Distribuidora

Sistema financeiro da Lube. Primeiro módulo: **Validação de Folha** — conferir, mês a mês e por
departamento, se o que foi pago no mês anterior continua sendo pago no mês atual.

- Banco: **Supabase, projeto DATA WAREHOUSE** (`ivcnotrynogaljrvvyes`), schema **`financeiro`**.
  Um banco só, um schema por sistema — nada no `public`, nada tocando `compras`, `core` ou `stg_compras`.
- Painel: site estático + função serverless na **Vercel**, região `gru1`.
- O navegador **nunca** fala com o banco: ele chama `/api/dados`, e a função conecta no servidor,
  com a senha vindo de variável de ambiente.

## O que o sistema faz

0. **A janela anda sozinha.** A competência atual é sempre a mais recente carregada, e ela é comparada
   com a imediatamente anterior: hoje `ago → set`; quando a folha de outubro entrar, vira `set → out`,
   sem ninguém mexer em nada. Quem decide é a função `painel_dados()`, pelo `max(competencia)`.
   O que foi confirmado num mês é o que serve de referência na comparação do mês seguinte.
   O seletor no topo permite olhar competências anteriores.
1. **Compara salário contratual e função** de cada colaborador entre a competência anterior e a atual.
2. Sem alteração nesses dois campos → passa direto, **sem alarme**. Variação de líquido por férias,
   atestado, admissão no meio do mês ou parcela de empréstimo não é alteração de contrato.
3. Alteração no salário contratual ou na função → **Alerta**.
4. Benefício descontado fora da tabela de referência (dobro, triplo, valor quebrado) → **Revisar**.
5. Clicar em qualquer pessoa abre o **comparativo completo**: todas as rubricas lado a lado,
   totais, bases de INSS/FGTS/IRRF e os eventos do mês.
6. Cada rubrica pode ser **corrigida à mão**, com observação. O valor original fica guardado ao lado.
7. **Confirmar** fecha a pessoa e o valor vira referência do mês seguinte. **Verificar** mantém pendente.

Status possíveis: `Conferido`, `Alerta`, `Revisar`, `Novo`, `Confirmado`, `Em verificação`, `Corrigido`.

## Estrutura

```
dados/      folha extraída dos PDFs, em JSON — FORA do git
scripts/    gerar-snapshot.js — monta um web/snapshot.js local, para testar sem banco
web/        painel publicado na Vercel
web/api/    funções serverless (dados.js = leitura, acao.js = escrita)
web/db/     SQL dos objetos de banco que o painel usa
```

## Dado de folha não entra no git

`dados/*.json` e `web/snapshot.js` estão no `.gitignore`. Salário é nominal e identificável:
o lugar dele é o banco, com RLS ligado e leitura só pelo servidor. O repositório guarda código,
schema e documentação — não guarda quanto cada pessoa ganha.

Por isso o painel publicado **só mostra número quando o banco responde**. Sem as variáveis de
ambiente cadastradas, ele abre e diz o que está faltando, em vez de exibir dado velho.

## Banco

| Objeto | Para que serve |
|---|---|
| `financeiro.fato_folha_colaborador` | Cabeçalho do recibo: cadastro, totais e bases, por competência |
| `financeiro.fato_folha_rubrica` | Itens do recibo: proventos (P) e descontos (D) |
| `financeiro.beneficio_referencia` | Valores de referência dos benefícios, editáveis na tela |
| `financeiro.validacao_folha` | Confirmado / Em verificação / Corrigido, por pessoa e competência |
| `financeiro.correcao_folha` | Valor corrigido à mão, com o original ao lado |
| `financeiro.controle_carga` | Resultado de cada carga — é aqui que se responde "a carga entrou?" |
| `financeiro.painel_dados(dep, competencia)` | Devolve o payload inteiro do painel em JSON |

Toda tabela nasce com **RLS ligado e sem políticas**, e `anon`/`authenticated` sem privilégio nenhum.

## Carga inicial (2026-09-24)

Folhas de **agosto e setembro/2026 do Administrativo**, extraídas dos PDFs do DP.

| Competência | Colaboradores | Rubricas | Proventos | Descontos | Líquido |
|---|---|---|---|---|---|
| 2026-08 | 20 | 75 | 54.817,13 | 16.413,58 | 38.403,55 |
| 2026-09 | 21 | 83 | 63.943,34 | 16.835,86 | 47.107,48 |

Os três totais de cada mês batem com o **resumo impresso na própria folha**, e a soma das rubricas
bate com o total de cada recibo. Conferido em `financeiro.controle_carga`.

Achados da primeira validação:

- **Gabryele Oliveira dos Reis (000921)** — Auxiliar → Assistente Administrativo, salário contratual
  de R$ 1.712,00 para R$ 1.928,14. Único caso de alteração de contrato.
- **Keli Sfalsin Gatti (000654)** — em setembro foram descontados R$ 258,66 de assistência
  médica-dependente (2× a tabela) e R$ 36,18 de odontológica-dependente (3×), sendo que em agosto,
  de férias, ela não teve nenhum dos dois. A conferir com o DP.
- Os valores da tabela de benefícios foram **deduzidos das próprias folhas** — confirmar com o
  contrato dos planos antes de tratar como verdade.

## Rodar local

```bash
node scripts/gerar-snapshot.js     # opcional: gera web/snapshot.js a partir de dados/
npx serve web                      # ou qualquer servidor estático
```

Com o `snapshot.js` gerado, o painel abre sem banco e **avisa na tela** que está offline — o que
for confirmado fica só naquele navegador. Esse arquivo é só para teste local e nunca é publicado.

## Variáveis de ambiente

São cinco, iguais no `ENV` local e no projeto da Vercel (Settings › Environment Variables),
marcadas para **Production, Preview e Development**:

| Variável | Valor |
|---|---|
| `SUPABASE_DB_HOST` | `aws-0-sa-east-1.pooler.supabase.com` |
| `SUPABASE_DB_PORT` | `6543` (transaction pooler — é o que a função serverless usa) |
| `SUPABASE_DB_NAME` | `postgres` |
| `SUPABASE_DB_USER` | `postgres.ivcnotrynogaljrvvyes` |
| `SUPABASE_DB_PASSWORD` | a senha do banco do projeto DATA WAREHOUSE |

Só a última é segredo. Quem preenche é o Júlio — ela não entra em arquivo nem em documentação.

A função confere o `ref` do projeto no usuário do banco antes de conectar: a máquina do Júlio tem
variáveis de ambiente apontando para o **painel-icms-lube**, e sem essa checagem um deploy mal
configurado escreveria no banco errado sem avisar.

## Próximo mês

Hoje a folha entra por carga a partir do JSON em `dados/`. O passo seguinte é um importador que leia
o PDF do DP direto e grave nas mesmas tabelas — a estrutura já está pronta para receber qualquer
competência e qualquer departamento (Administrativo, Logística, Transporte).
