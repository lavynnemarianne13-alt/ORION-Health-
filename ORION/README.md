# ORION

**Português (Brasil)** · [English](README.en.md)

O ORION é um protótipo de pesquisa para acompanhar o perfil corporal, exercícios e observações do smartwatch de astronautas. O projeto foi desenvolvido para o desafio **Create Health Monitoring Software for Astronauts on Space Missions**, do NASA Space Apps Challenge 2026. O sistema apresenta métricas experimentais e fichas para revisão profissional. [Desafio NASA Space Apps](https://www.spaceappschallenge.org/2026/challenges/health-monitoring-software/)

## Instalação e uso

No Ubuntu, use Python 3.12 com `venv`, Node.js 24 ou superior, npm, curl e flock. A instalação padrão usa SQLite local e inicia sem chave Gemini, relógio ou runtime YOLO. As dependências são baixadas dos registros configurados no pip e npm. No terminal, entre na pasta que contém este README.

```bash
bash setup.sh
bash start.sh
```

Abra [http://127.0.0.1:5173/](http://127.0.0.1:5173/). O FastAPI usa a porta 8000 com acesso local. Os logs ficam em `.runtime/`. Use Ctrl+C no terminal de inicialização ou `bash stop.sh` em outro terminal. Se uma porta estiver ocupada, o supervisor encerra a tentativa de inicialização do serviço que depende dela.

| Caminho | Conteúdo |
| --- | --- |
| `frontend/` | Vite, React e TypeScript. Overview, Body Profile, Body Atlas, AI Workout Planner, Movement, ORION Wear e History. |
| `backend/` | FastAPI, SQLAlchemy, migrações SQLite, Gemini e inferência YOLO opcional. |
| `wearable/receiver/` | Receptor Node.js com SQLite e o protocolo original da equipe. |
| `scripts/` | Carregamento de configurações, auditoria e preparação de cópia do dataset. |
| `data/` | Bancos privados e cópias de trabalho. |
| `docs/` | Contratos, regras do Movement e resultados de validação. |

## Perfis, exercícios e histórico

### Primeiro acesso

1. Em **Overview**, digite um pseudônimo em **Register a pseudonymous crew member** e clique em **Create profile**. Copie o **Profile ID**. Para voltar a esse perfil, cole o identificador no campo de busca e clique em **Find profile**.
2. Em **Body Profile**, preencha altura e peso. Para um ensaio com dados fictícios, use 5 ft, 10 in e 165 lb. Circunferências em polegadas são opcionais. Clique em **Save local measurement** e confira o IMC e a entrada no histórico. O SQLite armazena as medidas em kg e cm.
3. Em **Body Atlas**, alterne **Front** e **Back** e selecione uma região. Para ver uma medida vinculada, salve primeiro a circunferência da região correspondente em **Body Profile**.
4. Em **History**, confira as medidas, fichas, sessões e leituras do perfil ativo. Para trocar de astronauta, volte a **Overview** e use **Change profile**.

### Gerar e revisar uma ficha

1. Configure o Gemini conforme a seção abaixo, reinicie o ORION e selecione um perfil com altura e peso registrados.
2. Em **AI Workout Planner**, informe nível de treino, dias disponíveis, equipamentos e condições de segurança. Autorize o processamento externo e clique em **Generate workout draft**.
3. Leia a proposta em **AI Workout Planner** ou **History**. Após a aprovação por um profissional qualificado, informe o nome do revisor na ficha em **History**, marque a confirmação e clique em **Record review**.
4. Em **Movement**, selecione agachamento ou extensão de joelho para ver a opção **Reviewed workout** quando houver uma ficha revisada para o exercício.

### Registrar uma sessão em Movement

1. Selecione o astronauta em **Overview**. Abra **Movement**, escolha o exercício e, se solicitado, o lado a acompanhar.
2. Em **Pose model**, selecione **MediaPipe** ou **Orion Dataset · YOLO-Pose**, conforme a configuração de visão. Clique em **Enable camera**, autorize o navegador e enquadre a região indicada por **Movement**.
3. Clique em **Start server session** para abrir o registro no SQLite. Clique em **Start pose tracking** e acompanhe os pontos, os ângulos e as tentativas no painel.
4. Use **Record set** após as repetições válidas de cada série. Clique em **Finish server session** para salvar o resultado e abra **History** para conferir o exercício, as séries e as medições da sessão.
5. Use **ORION Wear** para acompanhar um relógio associado ao mesmo perfil. O painel mostra o último recebimento e sinaliza quando não há observações recentes.

Para ativar o provedor, edite o arquivo privado `.env` criado pelo setup e preencha `GEMINI_API_KEY`, `ORION_AI_ENABLED=1` e, opcionalmente, `ORION_AI_MODEL`. O padrão é `gemini-3.5-flash-lite`. O backend exclui o UUID antes de montar a chamada. O acesso depende da chave e das permissões da conta Google. [Modelos Gemini](https://ai.google.dev/gemini-api/docs/models)

## Visão computacional e treinamento

### Baixar e configurar o dataset

1. Se a pasta `data/datasets/Orion_dataset` já estiver presente, use a cópia incluída. Para obter a distribuição original da equipe, baixe o material. [Dataset ORION no Google Drive](https://drive.google.com/drive/u/0/folders/1wpiZ1MkQ2vvVa4rKYaR_v4T7N0s6r_JS)
2. Extraia o download, se necessário, e localize a pasta `Orion_dataset` que contém `data.yaml` e `fitness_pose/`. Mantenha a estrutura original.
3. Coloque a pasta em `data/datasets/Orion_dataset` ou configure `ORION_DATASET_DIR` no arquivo privado `.env` com o caminho correto. Se o Drive solicitar permissão, solicite acesso ao responsável pela pasta.

`ORION_DATASET_DIR` aponta para o diretório `Orion_dataset`. O setup procura primeiro em `data/datasets/Orion_dataset` e também reconhece uma única cópia nas pastas irmãs. Para usar outra localização, indique o caminho em `.env`. O peso padrão é `fitness_pose/runs/pose/squat_finetune/weights/best.pt`. Use apenas checkpoints de procedência confiável. Ative `ORION_ENABLE_YOLO=1` e rode o setup para instalar o runtime opcional. Use `ORION_POSE_WEIGHTS` para selecionar outro peso da equipe, `ORION_POSE_DEVICE=cpu` para CPU ou `auto` para tentar CUDA com fallback para CPU. Uma instalação CUDA exige um índice de wheels adequado em `ORION_TORCH_INDEX_URL` e driver funcional. [Índice oficial PyTorch para CPU](https://download.pytorch.org/whl/cpu/)

O MediaPipe usa o arquivo Full da equipe via API e pode recorrer ao modelo Lite oficial. O navegador carrega o Tasks Vision 0.10.21 sob demanda. Para uso isolado, coloque `vision_bundle.mjs` e a pasta `wasm/` da versão fixa em `frontend/public/mediapipe-runtime/` e defina `VITE_MEDIAPIPE_RUNTIME=/mediapipe-runtime`. `ORION_MEDIAPIPE_MODEL` permite escolher outro arquivo local `.task`. Em Movement, escolha MediaPipe e marque **Compare YOLO overlay** para executar ambos a partir da mesma câmera. A contagem e o registro continuam vinculados ao motor principal da sessão. [MediaPipe Pose Landmarker para Web](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker/web_js)

Para treinar ou validar uma cópia de trabalho, com a variável `ORION_DATASET_DIR` exportada:

```bash
python3 scripts/audit_dataset.py "$ORION_DATASET_DIR"
python3 scripts/prepare_squat_dataset.py "$ORION_DATASET_DIR" data/squat-training
.venv-yolo/bin/yolo pose val model="$ORION_DATASET_DIR/fitness_pose/runs/pose/squat_finetune/weights/best.pt" data="$PWD/data/squat-training/data.yaml" device=cpu project="$PWD/data/runs"
.venv-yolo/bin/yolo pose train model="$ORION_DATASET_DIR/fitness_pose/runs/pose/squat_finetune/weights/best.pt" data="$PWD/data/squat-training/data.yaml" device=cpu project="$PWD/data/runs"
```

Execute o treinamento somente após revisar as anotações e a composição do conjunto de validação. O comando inicializa um novo fine-tuning com pesos da equipe. `squat_finetune` e `custom_finetune` têm `epoch=-1` no pickle dos arquivos `last.pt`. O `space_finetune/weights/last.pt` tem `epoch=15`, mas aponta para o manifesto temporário original `/tmp/orion_combined_data.yaml`, ausente no material auditado. Recupere o manifesto exato, preserve os splits e confirme o estado do otimizador antes de usar `resume=True` numa cópia do checkpoint. Consulte também os scripts da equipe em `fitness_pose/modules/`.

## Galaxy Watch4 e ORION Wear

1. Crie ou abra o astronauta em **Overview**. Configure seu UUID em `ORION_WATCH_ATHLETE_ID` e um identificador do dispositivo em `ORION_WATCH_DEVICE_ID`.
2. Configure um token privado compartilhado com o aplicativo por meio de `ORION_WATCH_TOKEN_FILE` ou `ORION_WATCH_TOKEN`. O receptor exige ao menos 32 caracteres. O token identifica a instalação configurada, com um relógio por receptor. Mantenha o arquivo com permissão `0600`.
3. Conecte o relógio e o computador à mesma rede privada. Para receber pela rede local, configure `ORION_WATCH_HOST=0.0.0.0` e `ORION_WATCH_PORT=8001` ou outra porta disponível. No app instalado, configure `http://IP_LOCAL:8001` e o mesmo token. Use as permissões que o aplicativo solicitar para os sensores utilizados. O código e o APK Wear OS não vieram na cópia local auditada.
4. Execute `bash start.sh`. O painel indica a disponibilidade, atualiza automaticamente e apresenta timestamps de coleta quando informados. O campo legado `sleep_session_minutes` aparece como duração de observação. O botão de conexão e a troca de token no relógio dependem do aplicativo instalado.

O receptor preserva `POST /api/saude` e `GET /api/saude` com `Authorization: Bearer …`. O backend consulta o receptor com o token privado e verifica o vínculo retornado antes de exibir dados. As leituras são relacionadas a uma sessão concluída somente quando o horário de coleta explícito cai dentro de uma única sessão do mesmo atleta. Para receptores em outra máquina, configure `ORION_WATCH_RECEIVER` para a URL do serviço compatível. As APIs de dashboard servem uma estação local confiável. Em transporte fora da rede privada, use HTTPS e controle de acesso.

## SQLite, backup e problemas comuns

O banco padrão do FastAPI fica em `data/orion.sqlite`. Para aproveitar um banco anterior, indique seu caminho em `ORION_DB_PATH` antes do setup. A cada execução, o setup cria um backup SQLite consistente de um banco existente antes da migração. Para backups avulsos, use a API de backup do SQLite ou pare o sistema antes de copiar o arquivo. Cada receptor iniciado pelos scripts usa `data/watch-<UUID>.sqlite`. Para importar um histórico conhecido, configure `ORION_WATCH_DB_PATH` para uma cópia consistente do banco e confira a identidade do atleta antes de associá-la. Uma associação já gravada no arquivo precisa coincidir com a configuração.

- **Porta em uso ou bind negado**. Consulte `.runtime/` e execute em uma sessão do Ubuntu que permita sockets locais.
- **SQLite indisponível**. Rode `bash setup.sh`, confira `ORION_DB_PATH` e a saída de `alembic upgrade head`.
- **Sem leitor Wear**. Confira o UUID, o token em ambos os lados, o IP do computador, a rede e `.runtime/wear.log`.
- **Sem dados de câmera**. Conceda permissão ao navegador. Confira `/api/v1/pose/model` no backend para YOLO e o runtime/asset para MediaPipe.
- **Gemini indisponível**. Confira a configuração do backend, a disponibilidade do modelo para a chave e a rede. O frontend mantém os demais módulos acessíveis.

## Como testar o ORION

Execute os comandos a partir de `ORION/`. Rode `bash setup.sh` primeiro. Use pseudônimos e dados fictícios nos ensaios manuais para distinguir os registros de teste.

### Teste manual no navegador

Com `bash start.sh` em execução, confira o backend em outro terminal:

```bash
curl --fail --silent --show-error http://127.0.0.1:8000/health
curl --fail --silent --show-error http://127.0.0.1:8000/ready
```

O primeiro comando retorna `"status":"ok"`. O segundo retorna `"status":"ready"` e `"database":"ok"`. Abra [o painel do ORION](http://127.0.0.1:5173/) e percorra os cenários.

| Cenário | Como executar | Resultado esperado |
| --- | --- | --- |
| Cadastro, medidas e persistência | Crie o perfil `Teste ORION A`, salve a medida do exemplo e recarregue a página. | O perfil e a medida continuam acessíveis. A lista em **History** mostra a entrada salva. |
| Isolamento de perfis | Use **Change profile**, cadastre `Teste ORION B` e abra **History**. Depois reabra A com **Find profile**. | B começa sem os registros de A. Ao retornar para A, a medida reaparece. |
| Evolução corporal | Salve uma segunda medida com outro peso no mesmo perfil e confira **Body Profile**. | O painel usa a medida mais recente e o histórico mostra as duas entradas. |
| Planner | Com Gemini ativo, use um perfil fictício com medidas e autorize o processamento. Faça também uma tentativa sem consentimento. | O pedido autorizado retorna uma ficha para revisão quando há opções válidas. Sem consentimento, o botão de envio permanece desativado. |
| Câmera e sessão | Com um motor de visão disponível, siga o fluxo de **Movement** e finalize a sessão. Saia do enquadramento antes de voltar a se mover. | O painel sinaliza a perda de pose. **History** mostra a sessão finalizada e as séries marcadas. |
| Wear sem relógio | Abra **ORION Wear** sem um receptor configurado para o perfil selecionado. | O painel indica que o relógio está indisponível ou sem configuração. Os demais módulos continuam acessíveis. |
| Wear com relógio | Configure o Galaxy Watch4, envie uma leitura, interrompa o envio e depois retome. | A hora de recebimento avança, o painel indica ausência de observações recentes após cerca de 30 segundos e volta a atualizar quando o envio retorna. |

### Testes automatizados do núcleo

```bash
(cd frontend && npm run build && npm run lint && npm test)
.venv/bin/pip install -r backend/requirements-test.txt
.venv/bin/python backend/tests/check_core.py
(cd wearable/receiver && npm test)
```

- **Frontend:** espere o build concluído, o ESLint sem erros e a suíte de Movement aprovada. A suíte usa exemplos de ângulos e rastreamento simulados.
- **FastAPI e SQLite:** procure `Core ASGI/SQLite integration passed`. O teste cria um banco temporário e verifica migrações, perfis, medidas, fichas, sessões, séries e associação Wear. O provedor Gemini é simulado e nenhuma chave real é necessária.
- **Receptor:** a suíte inclui autenticação, validação de dados, persistência e testes HTTP locais. Se o ambiente bloquear sockets, execute os testes em processo:

```bash
(cd wearable/receiver && node --test server/watch-handler.test.mjs server/exercise-store.test.mjs server/wellness-store.test.mjs)
```

### Auditoria do dataset e inferência YOLO

Para usar o dataset local e a configuração de `.env`, carregue o script de ambiente em um subshell:

```bash
(
  source scripts/environment.sh
  python3 scripts/audit_dataset.py "$ORION_DATASET_DIR"
)
```

A auditoria informa divergências de pareamento, anotações inválidas e integridade dos pesos. No conjunto local, ela sinaliza problemas nas variantes `custom_dataset` e `space_dataset`. Confira a saída de cada split.

Com `ORION_ENABLE_YOLO=1`, execute o setup e confirme que o runtime opcional foi instalado. Em um ambiente que permita sockets locais, rode:

```bash
(
  source scripts/environment.sh
  .venv-yolo/bin/python backend/tests/integration_check.py
)
```

O teste usa uma imagem do split de validação local e verifica a resposta YOLO com 15 pontos, a entrega do arquivo MediaPipe Full e a persistência de sessões em um SQLite temporário. Se quiser selecionar a imagem, adicione `--image "/caminho/para/imagem.jpg"`. Para verificar MediaPipe em execução, câmera e comparação entre os motores, faça o cenário manual de **Movement**.

O [relatório de auditoria e validação](docs/VALIDATION.md) registra os testes já executados, os dados simulados e as verificações que ainda dependem de hardware ou credenciais.
