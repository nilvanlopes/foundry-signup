# Foundry Signup

Pagina propria de cadastro para usuarios do Foundry. O objetivo e controlar a
experiencia de cadastro fora dos limites visuais dos stages nativos do authentik.

## Stack

- Node.js 22
- Fastify para backend/API
- Vite + TypeScript + CSS nativo para frontend
- Docker multi-stage
- Traefik via Docker Swarm labels

Essa stack foi escolhida porque o frontend fica leve, enquanto o backend guarda
com seguranca os tokens do authentik e do Google. Nenhum segredo fica exposto no
navegador.

## Fluxos

### Cadastro Manual

1. Usuario preenche `username`, `email`, `password` e `confirm password`.
2. Backend valida o `itoken` do convite no authentik.
3. Backend envia os dados para o flow `foundry-enrollment`.
4. O proprio flow do authentik cria o usuario, envia o e-mail de confirmacao e ativa a conta quando o link do e-mail for aberto.
5. O flow de confirmacao deve redirecionar para o Foundry.

### Cadastro Com Google

1. Usuario preenche `username`.
2. Backend valida o `itoken` do convite no authentik.
3. Backend inicia OAuth com Google.
3. Google retorna para `/api/oauth/google/callback`.
4. Backend valida e-mail verificado do Google.
5. Backend cria/linka usuario no authentik com o username escolhido.
6. Backend adiciona o usuario ao grupo `foundry-users`.
7. Usuario e redirecionado para o Foundry.

## Configuracao

Copie o exemplo:

```bash
cp .env.example .env
```

Preencha:

```dotenv
PUBLIC_BASE_URL=https://signup.example.com
AUTHENTIK_BASE_URL=https://authentik.example.com
AUTHENTIK_API_TOKEN=token-limitado-do-authentik
AUTHENTIK_INVITE_FLOW_SLUG=foundry-enrollment
AUTHENTIK_FOUNDRY_GROUP_NAME=foundry-users
AUTHENTIK_FOUNDRY_APP_URL=https://foundry.example.com
GOOGLE_CLIENT_ID=client-id
GOOGLE_CLIENT_SECRET=client-secret
GOOGLE_REDIRECT_URI=https://signup.example.com/api/oauth/google/callback
SESSION_SECRET=string-randomica-com-32-caracteres
```

No Google Cloud Console, adicione o redirect URI:

```text
https://signup.example.com/api/oauth/google/callback
```

## Token Do Authentik

Crie um usuario/service account no authentik com permissao minima para:

- ler convites
- apagar convites, se usar `single_use`
- listar grupos
- listar usuarios
- criar usuarios
- alterar senha de usuario
- adicionar usuario ao grupo `foundry-users`

Use esse token em `AUTHENTIK_API_TOKEN`.

## Link De Convite

Crie o convite no authentik normalmente e envie o UUID do convite como `itoken`
para a pagina propria:

```text
https://signup.example.com/?itoken=00000000-0000-0000-0000-000000000000
```

Sem esse `itoken`, ou com um convite expirado, a pagina bloqueia o cadastro.
O convite deve estar associado ao flow configurado em `AUTHENTIK_INVITE_FLOW_SLUG`.

## Rodar Local

```bash
npm install
npm run dev:server
```

Em outro terminal:

```bash
npm run dev
```

## Build

```bash
npm run build
npm start
```

## Docker

```bash
docker compose up --build
```

Para Swarm:

```bash
docker stack deploy -c docker-compose.yml foundry-signup
```

## Pendencias Antes De Produzir

- Confirmar permissao exata do token no authentik.
- Confirmar se o endpoint `set_password` esta habilitado na versao atual do authentik.
- Adicionar rate limit por IP.
- Adicionar armazenamento persistente para `state` OAuth se houver mais de uma replica.
- Se usar mais de uma replica, trocar o Map em memoria por Redis.
