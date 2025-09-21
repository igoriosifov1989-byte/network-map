# Makefile for Diagram Generator Kubernetes Deployment

.PHONY: help build push deploy logs clean status

# Variables
APP_NAME = diagram-generator
VERSION = latest
NAMESPACE = diagram-generator
REGISTRY = localhost:5000

help: ## Show this help message
	@echo "Available commands:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

build: ## Build Docker image
	@echo "Building Docker image..."
	docker build -t $(APP_NAME):$(VERSION) .
	@echo "Image built successfully: $(APP_NAME):$(VERSION)"

tag: build ## Tag image for registry
	@echo "Tagging image for registry..."
	docker tag $(APP_NAME):$(VERSION) $(REGISTRY)/$(APP_NAME):$(VERSION)

push: tag ## Push image to registry
	@echo "Pushing image to registry..."
	docker push $(REGISTRY)/$(APP_NAME):$(VERSION)
	@echo "Image pushed successfully"

deploy: ## Deploy to Kubernetes
	@echo "Deploying to Kubernetes..."
	kubectl apply -k k8s/overlays/local
	@echo "Deployment completed"
	@echo "Waiting for pods to be ready..."
	kubectl wait --for=condition=ready pod -l app.kubernetes.io/name=$(APP_NAME) -n $(NAMESPACE) --timeout=300s

deploy-local: build deploy ## Build and deploy locally
	@echo "Local deployment completed"

status: ## Check deployment status
	@echo "Checking deployment status..."
	kubectl get all -n $(NAMESPACE)
	@echo ""
	@echo "Pod details:"
	kubectl get pods -n $(NAMESPACE) -o wide

logs: ## View application logs
	@echo "Application logs:"
	kubectl logs -n $(NAMESPACE) -l app=diagram-generator-app -f --tail=50

logs-db: ## View database logs  
	@echo "Database logs:"
	kubectl logs -n $(NAMESPACE) -l app=postgres -f --tail=50

port-forward: ## Forward port to access application locally
	@echo "Port forwarding to localhost:8080..."
	@echo "Access the application at: http://localhost:8080"
	kubectl port-forward -n $(NAMESPACE) svc/local-diagram-generator-service 8080:80

shell-app: ## Get shell access to application pod
	kubectl exec -it -n $(NAMESPACE) deployment/local-diagram-generator-app -- /bin/sh

shell-db: ## Get shell access to database
	kubectl exec -it -n $(NAMESPACE) deployment/local-postgres-deployment -- psql -U postgres -d diagram_generator

scale-up: ## Scale application to 2 replicas
	kubectl scale deployment local-diagram-generator-app -n $(NAMESPACE) --replicas=2
	@echo "Scaled to 2 replicas"

scale-down: ## Scale application to 1 replica
	kubectl scale deployment local-diagram-generator-app -n $(NAMESPACE) --replicas=1
	@echo "Scaled to 1 replica"

restart: ## Restart application deployment
	kubectl rollout restart deployment/local-diagram-generator-app -n $(NAMESPACE)
	kubectl rollout status deployment/local-diagram-generator-app -n $(NAMESPACE)

clean: ## Remove all deployed resources
	@echo "Removing all resources..."
	kubectl delete -k k8s/overlays/local --ignore-not-found=true
	@echo "Cleanup completed"

clean-namespace: ## Delete entire namespace
	@echo "Deleting namespace $(NAMESPACE)..."
	kubectl delete namespace $(NAMESPACE) --ignore-not-found=true
	@echo "Namespace deleted"

update: build ## Update application with new image
	@echo "Updating application..."
	kubectl set image deployment/local-diagram-generator-app -n $(NAMESPACE) app=$(APP_NAME):$(VERSION)
	kubectl rollout status deployment/local-diagram-generator-app -n $(NAMESPACE)
	@echo "Update completed"

backup-db: ## Backup database
	@echo "Creating database backup..."
	kubectl exec -n $(NAMESPACE) deployment/local-postgres-deployment -- pg_dump -U postgres diagram_generator > backup-$(shell date +%Y%m%d-%H%M%S).sql
	@echo "Backup created"

test: ## Run a simple test against the deployed application
	@echo "Testing deployment..."
	@if kubectl get pods -n $(NAMESPACE) | grep -q "Running"; then \
		echo "✓ Pods are running"; \
	else \
		echo "✗ Pods are not running"; \
		exit 1; \
	fi
	@echo "✓ Deployment test passed"

# Development helpers
dev-setup: ## Setup development environment
	@echo "Setting up development environment..."
	@which kubectl > /dev/null || (echo "kubectl is required" && exit 1)
	@which docker > /dev/null || (echo "docker is required" && exit 1)
	@echo "✓ Prerequisites check passed"

# Quick commands
quick-deploy: dev-setup deploy-local test ## Full deployment pipeline
	@echo "🚀 Quick deployment completed successfully!"
	@echo "Application is running at: http://localhost:30080"

# Monitoring
top: ## Show resource usage
	kubectl top pods -n $(NAMESPACE) 2>/dev/null || echo "Metrics server not available"

events: ## Show recent events
	kubectl get events -n $(NAMESPACE) --sort-by='.lastTimestamp'