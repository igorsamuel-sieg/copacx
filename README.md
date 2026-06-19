# ⚽ VAR da Qualidade — Copa CX SIEG

Jogo dos 7 erros multiplayer com times por cor.

## Setup

```bash
npm install
npm start
```

## Variáveis de ambiente (Render.com)

| Variável | Padrão | Descrição |
|---|---|---|
| `MASTER_PASSWORD` | `cxsieg2025` | Senha para entrar como Master |
| `SPECTATOR_PASSWORD` | `espectador` | Código para modo espectador |
| `PORT` | `3000` | Porta (Render define automaticamente) |

**Importante:** troque as senhas padrão antes de divulgar a sala — configure
`MASTER_PASSWORD` e `SPECTATOR_PASSWORD` nas variáveis de ambiente do Render.

## Como jogar

1. **Master** entra com a senha master → vê o gabarito automaticamente → configura os times → inicia o jogo
2. **Jogadores** entram com nome + time → esperam o sinal
3. Clique nas diferenças da **Imagem B** — 7 erros no total
4. 3 erros consecutivos = penalidade de tempo
5. **Ao encontrar os 7 erros, o jogador para automaticamente e aguarda** — ele não pode mais clicar
6. **Assim que o 3º jogador completar os 7 erros, o jogo encerra para todos automaticamente** e o ranking final é exibido (1º, 2º e 3º colocados são quem terminou primeiro; os demais são ordenados por progresso)
7. O Master também pode encerrar manualmente a qualquer momento pelo botão "Encerrar agora", caso necessário

## Os 7 erros (Imagem A vs Imagem B)

1. Placar do CX SIEG FC: "2" azul vira "3"
2. Bandeirola "GARRA / FOCO / RESULTADO": linha "FOCO" removida
3. Troféu pequeno (ícone neon) ao lado da bandeirola: desaparece
4. Bola de futebol: texto "CX" vira "FC"
5. Caneca: texto "EM FOCO" vira "EM TIME"
6. Caderno: texto "SOLUÇÃO" vira "ENTREGA"
7. Placa "ATITUDE / AGILIDADE / RESPEITO": linha "AGILIDADE" removida

O Master vê automaticamente um gabarito com os 7 pontos numerados e circulados,
sem precisar adivinhar onde estão.

## Segurança contra "espertinhos"

- **Coordenadas dos erros nunca são enviadas ao cliente** — toda validação de clique acontece no servidor
- **Gabarito protegido**: só acessível via token de uso único, válido por 30 min e amarrado ao IP de quem entrou como Master; tentativa de acessar a URL direto sem token retorna 403
- **Rate-limit de senha**: máximo de 8 tentativas de senha (master/espectador) por IP a cada 60s, evitando força bruta
- **Anti-bot de cliques**: cliques disparados mais rápido que ~280ms são ignorados no servidor, dificultando scripts automatizados
- **Nome duplicado bloqueado**: não é possível entrar duas vezes na mesma sala com o mesmo nome (evita multi-aba/espionagem do próprio progresso)
- **Proteções de front-end**: botão direito desabilitado sobre a imagem do jogo, arrastar imagem bloqueado, atalhos comuns de DevTools (F12, Ctrl+Shift+I/J/C, Ctrl+U, Ctrl+P, Ctrl+S) bloqueados durante a partida para jogadores
- Essas proteções de front-end **não substituem** a validação no servidor — a defesa real está em nunca expor as coordenadas dos erros ao cliente, o que já é garantido

## Imagens

- `/public/images/modified.webp` — imagem que os jogadores veem e clicam (com os 7 erros já editados)
- `/public/images/original.webp` — gabarito numerado, servido só ao Master autenticado

## Deploy no Render

- Build Command: `npm install`
- Start Command: `node server.js`

