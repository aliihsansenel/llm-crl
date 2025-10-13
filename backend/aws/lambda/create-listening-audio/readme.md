zip -r deployment-package.zip .

aws lambda update-function-code \
  --function-name create-listening-audio \
  --zip-file fileb://deployment-package.zip