zip -r deployment-package.zip .

aws lambda update-function-code \
  --function-name create-listening-audio-invoked \
  --zip-file fileb://deployment-package.zip


aws lambda update-function-configuration \
    --function-name create-listening-audio-invoked \
    --timeout 60