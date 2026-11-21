ORION — receptor do relógio

1. Instale Node.js 24 LTS no computador 192.168.20.101.
2. Extraia esta pasta. Não precisa de npm install: o servidor usa módulos do Node.
3. Carlos deve copiar separadamente o arquivo privado .watch-token da pasta
   /home/carlos/Documentos/files(1)/ para esta pasta, ao lado de package.json.
   Use transferência privada (por exemplo, pendrive). Não cole a chave no chat.
   O arquivo deve ser o existente: criar outra chave impediria o relógio atual de conectar.
4. Windows: abra START_RECEIVER.cmd. Linux: bash START_RECEIVER.sh.
5. Deixe o terminal aberto. Permita TCP 8001 na rede privada se o firewall bloquear.

Relógio configurado: http://192.168.20.101:8001
Dados persistidos: data/watch-history.sqlite (criado automaticamente).
Este pacote não contém dados pessoais históricos nem a chave de autenticação.

Frontend separado: use a integração já enviada, configurando o proxy do Vite
para http://192.168.20.101:8001 e o caminho do arquivo .watch-token.
A autenticação deve ser adicionada pelo proxy no servidor, nunca pelo navegador.
Uma requisição sem autenticação a /api/saude deve retornar HTTP 401 quando o
receptor estiver acessível. Isso indica que o serviço está respondendo.
