param ($env)
$stack =$env + "transformed-image-bucket-stack"
aws cloudformation create-stack --stack-name $stack --template-body file://transformed-image-bucket.yml --parameters ParameterKey=Env,ParameterValue=staging --profile doctorus