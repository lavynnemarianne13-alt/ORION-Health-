# Auditoria e validação do ORION

## Origem, dependências e preservação

A pasta `ORION/` usa o conteúdo de execução do arquivo `ORION-Health-Complete-Integration-English.zip`, que inclui um fluxo de Movement e testes ausentes na árvore portuguesa extraída. O receptor Node.js veio de `ORION_Receptor (3)/`. Os originais e o dataset permaneceram no lugar. Uma cópia adicional das árvores locais de código foi criada em `/tmp/orion-original-snapshot`. A busca anterior às alterações não encontrou bancos SQLite ativos. A migração foi testada com banco novo e com registros de uma revisão anterior.

O `.git` montado no raiz estava vazio e somente leitura. `git ls-remote` falhou por DNS, e as consultas web ao GitHub e à API do repositório falharam. Assim, as branches remotas e a presença de arquivos Git LFS no remoto ficaram pendentes e a branch pedida não pôde ser criada com o histórico original. A distribuição local tem checkpoints binários reais, com CRC de ZIP verificado. `git-lfs` não está instalado e a busca textual local não encontrou ponteiros LFS. A página oficial do desafio retornou HTTP 502 durante a consulta.

A instalação limpa do núcleo usou Python 3.12.3, Node.js 26.13.1, FastAPI 0.163.0, Uvicorn 0.54.0, SQLAlchemy 2.1.8, Alembic 1.20.1, Pydantic 2.14.3, React 19.3.1, TypeScript 6.0.3, Vite 8.3.8 e ESLint 10.15.0. O receptor usa `node:sqlite` e bibliotecas nativas do Node. O ambiente copiado no dataset é Windows/Python 3.13 e contém módulos `.pyd`. As dependências Linux de YOLO estão em ambiente opcional separado, com versões selecionadas a partir do material da equipe.

| Dependência opcional | Versão de configuração |
| --- | --- |
| Ultralytics | 8.4.213 |
| PyTorch e Torchvision | 2.15.0 e 0.29.2 |
| OpenCV | 5.0.0.93 |
| NumPy | 2.5.4 |
| Pillow e PyYAML | 13.0.0 e 6.0.3 |
| MediaPipe JavaScript/WASM | 0.10.21 |

O ambiente Linux não tinha wheels de NumPy e PyTorch no cache. O binário `nvidia-smi` não conseguiu se comunicar com o driver no sandbox. A execução MediaPipe usa JavaScript/WASM, de modo que dispensou as dependências Python de MediaPipe, Protobuf e a instalação simultânea de `opencv-contrib-python`.

## Dataset, pesos e resultados registrados pela equipe

Diretório original usado durante a auditoria:

```text
/home/gabriel/Documentos/ORION-Health--main/Orion_dataset-20261121T170259Z-1-001/Orion_dataset
```

O dataset auditado foi movido para `ORION/data/datasets/Orion_dataset` durante a organização local.

Foram encontrados a exportação compactada de squat, as divisões raiz, `custom_dataset`, `space_dataset`, os manifestos unificados, configurações, código de preparação/treino/inferência e três arquivos de resultados. A auditoria decodificou as imagens ativas com Pillow, verificou pareamento por nome, coordenadas normalizadas, visibilidade, classe e duplicatas byte a byte entre splits de cada variante. Não encontrou corpus de vídeo bruto ou split de teste no material ativo. O manifesto unificado recupera 416 caminhos de treino e 54 de validação após tradução dos caminhos Windows. Ele ainda precisa de tratamento das inconsistências nas divisões de origem antes de um novo treino.

| Variante | Treino | Validação | Achados |
| --- | --- | --- | --- |
| Exportação squat | 183 imagens / 183 rótulos | 5 / 5 | Pareamento e formato válidos. `data.yaml` original aponta para um teste ausente. |
| Custom | 159 / 159 | 35 / 34 | Um par ausente na validação. |
| Space | 86 / 75 | 16 / 15 | Treze nomes sem par no treino, um na validação e cinco arquivos inválidos no treino. |

| Execução | Pico histórico de pose mAP50–95 | SHA-256 inicial de `best.pt` / `last.pt` |
| --- | ---: | --- |
| `squat_finetune` | 0,48675 na época 37 | `e27db3a3dae5` / `b658c6450918` |
| `custom_finetune` | 0,10929 na época 22 | `ca71225ee44a` / `0a84301c74a6` |
| `space_finetune` | 0,11823 na época 10 | `3b92182e1d22` / `7a5ff04557b0` |

O candidato padrão é o checkpoint `squat_finetune/weights/best.pt`. Entre as variantes auditadas, ele combina o split de origem formalmente íntegro com evidência histórica de detecção de pose. Os picos vieram dos CSV da equipe, em conjuntos diferentes. A validação de squat tem cinco imagens e a métrica não mede desempenho clínico nem capacidade de generalização para outros exercícios ou microgravidade. `best_exercise_pose.pt` é idêntico ao `custom_finetune/best.pt`. `best_space_pose.pt` é outro binário, com SHA-256 inicial `6496c5c1260c`. Também foram encontrados o peso genérico `yolov8n-pose.pt`, usado como base de treino, e os arquivos MediaPipe Full e Heavy, com CRC válido. `squat_finetune_v2` tem apenas argumentos. Nenhum treino novo foi iniciado.

## Resultados nesta entrega

| Verificação | Resultado |
| --- | --- |
| Setup limpo em cópia temporária, usando os caches locais | Dependências do núcleo e migrações instaladas. |
| `npm run build`, `npm run lint`, `npm test` | TypeScript e Vite aprovados, ESLint limpo e suíte de Movement aprovada com dados simulados. |
| API e SQLite via ASGI com banco temporário | Migração com dados legados, isolamento de perfis, medidas, fichas revisadas, séries, histórico, associação temporal Wear simulada e entrega do arquivo MediaPipe Full aprovados. |
| Gemini simulado | 15 testes existentes aprovados, incluindo catálogo, consentimento, validação de dosagem e segurança. Teste integrado confirmou armazenamento de ficha aprovada pela validação e resposta 502 no timeout simulado. |
| Receptor Node sem socket | 3 arquivos de teste aprovados, incluindo protocolo simulado com token, rejeição de dado inválido, persistência e rejeição de troca de vínculo. Executável sem token terminou normalmente. |
| Scripts | Sintaxe Bash verificada. A tentativa de inicialização em HTTP foi bloqueada por `EPERM` em sockets locais. O teste HTTP original do Node falhou no ambiente restrito. |
| Visão em tempo real | Auditoria de dataset, integridade dos pesos e entrega do arquivo Full verificadas. Carregamento de YOLO em PyTorch, inferência em imagem, webcam, MediaPipe em execução e comparação simultânea seguem pendentes. |
| Hardware e serviços externos | Sem confirmação de câmera, Galaxy Watch4, sensores, aceleração NVIDIA ou resposta Gemini com credencial real. Navegação e desempenho concorrente em navegador aguardam ambiente com sockets. |

`check_core.py` usa um transporte ASGI em processo para exercitar os endpoints sem bind. Os valores usados em testes de Wear e Movement foram dados sintéticos ou fixtures de ângulos, sem medições reais de astronautas.

## Inventário da integração

- Base importada em `frontend/` e `backend/`. Os componentes de ultrassom do arquivo de origem foram excluídos da cópia de execução.
- Backend alterado em `main.py`, `models.py`, `movement_schemas.py`, `exercise_advisor.py`, `pose_api.py` e `requirements-pose.txt`. Foram adicionados `crew_records.py`, `wear_api.py`, dois scripts Alembic, o manifesto de testes e `tests/check_core.py`.
- Frontend alterado em `App.tsx`, `useBackend.ts`, `ProfilePanel.tsx`, `SessionHistory.tsx`, `BodyProfile.tsx`, `ExerciseAdvisor.tsx`, nos clientes e controles de Movement, nos tipos, no manifesto npm e no lockfile. O painel novo é `src/components/backend/WearPanel.tsx`.
- Receptor reaproveitado em `wearable/receiver/`. O servidor, o armazenamento e o teste `watch-handler.test.mjs` cobrem a ligação com o painel integrado.
- Automação e documentação em `setup.sh`, `start.sh`, `stop.sh`, `scripts/`, `.env.example`, `.gitignore`, `README.md` e `docs/`.

O núcleo Python usa requisitos fixados e o frontend usa `package-lock.json`. O manifesto opcional de YOLO fixa as bibliotecas principais. A resolução completa das dependências transitivas de visão em Linux e CUDA ainda precisa ser validada no ambiente que executar a inferência.

## Validação de visão no workspace oficial

Em 21 de novembro de 2026, o checkpoint `squat_finetune/weights/best.pt` foi executado em Zorin OS 18 com Ultralytics 8.4.213, PyTorch 2.15.0 e Torchvision 0.29.2. O teste HTTP `backend/tests/integration_check.py` confirmou a classe `lifter`, caixa normalizada, 15 pontos, respostas vazias para quadros sem pose e o ciclo de sessão em um SQLite temporário. Passou em CPU e em `cuda:0`, com as wheels `cu132` no ambiente de teste, uma RTX 3050 Laptop de 6 GB e driver 580.178.04.

Após aquecimento, foram feitas 20 chamadas ao processamento de quadros com as cinco imagens da validação, quatro por imagem. Todas retornaram 15 pontos. O tempo medido inclui decodificação JPEG e inferência, sem HTTP.

| Dispositivo | Mediana | Máximo |
| --- | ---: | ---: |
| Intel Core i5-13420H | 55,4 ms | 58,5 ms |
| NVIDIA RTX 3050 Laptop | 12,6 ms | 13,6 ms |

O Brave abriu a webcam física em 640×480 a 30 FPS. MediaPipe Full e Heavy detectaram pontos corporais visíveis em ensaios curtos. Com Full e comparação YOLO em CPU, o painel processou 25 respostas YOLO em cerca de cinco segundos, sem detecção YOLO nesse enquadramento. Em um fluxo de teste que repetia uma imagem do dataset, Full e Heavy detectaram pontos visíveis, e o YOLO retornou 15 pontos em todas as chamadas nos dois ensaios. O Heavy foi selecionado com `ORION_MEDIAPIPE_MODEL=fitness_pose/models/mediapipe/pose_landmarker_heavy.task` e identificado como **MEDIAPIPE HEAVY** no painel.

As medições descrevem ensaios locais curtos com um conjunto pequeno. A contagem de repetições e o registro de séries durante um exercício real, a detecção YOLO pela webcam e a estabilidade em uso prolongado seguem pendentes.
