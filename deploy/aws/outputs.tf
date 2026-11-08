output "site_url" {
  description = "Point your domain (CNAME or Route 53 alias) here."
  value       = aws_lb.main.dns_name
}

output "files_cdn" {
  value = "https://${aws_cloudfront_distribution.files.domain_name}"
}

output "app_repository" {
  value = aws_ecr_repository.app.repository_url
}

output "pipeline_repository" {
  value = aws_ecr_repository.pipeline.repository_url
}

output "seed_first_run" {
  description = "Run this once after the images are deployed: fetches the documents and loads everything (hours on the first run). Watch it in CloudWatch Logs, stream prefix seed/."
  value = local.ready ? join(" ", [
    "aws ecs run-task --region ${var.region} --cluster ${aws_ecs_cluster.main.name}",
    "--launch-type FARGATE --task-definition ${aws_ecs_task_definition.seed[0].family}",
    "--network-configuration 'awsvpcConfiguration={subnets=[${join(",", aws_subnet.public[*].id)}],securityGroups=[${aws_security_group.tasks.id}],assignPublicIp=ENABLED}'",
  ]) : "set app_image and pipeline_image (deploy/aws/build-push.sh), then apply again"
}

output "logs" {
  value = "aws logs tail /ecs/${var.name} --follow --region ${var.region}"
}
