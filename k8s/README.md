# Kubernetes Deployment for Diagram Generator

Полное развертывание приложения в Kubernetes с использованием Kustomize.

## Требования

- Kubernetes кластер (minikube, k3s, или docker-desktop)
- kubectl
- kustomize (входит в kubectl)
- Docker для сборки образов

## Быстрый старт

### 1. Сборка образа

```bash
# Сборка Docker образа
docker build -t diagram-generator:latest .

# Для локального реестра (если используется)
docker tag diagram-generator:latest localhost:5000/diagram-generator:latest
docker push localhost:5000/diagram-generator:latest
```

### 2. Развертывание

```bash
# Применить конфигурацию для локального окружения
kubectl apply -k k8s/overlays/local

# Проверить статус
kubectl get pods -n diagram-generator

# Проверить сервисы
kubectl get svc -n diagram-generator
```

### 3. Доступ к приложению

После развертывания приложение будет доступно по:

- **NodePort**: `http://localhost:30080` (или IP вашего кластера)
- **Port Forward**: 
  ```bash
  kubectl port-forward -n diagram-generator svc/local-diagram-generator-service 8080:80
  ```
  Затем: `http://localhost:8080`

## Структура файлов

```
k8s/
├── base/                          # Базовая конфигурация
│   ├── namespace.yaml            # Namespace
│   ├── configmap.yaml           # Переменные окружения
│   ├── secret.yaml              # Секреты (пароли БД)
│   ├── postgres-deployment.yaml # PostgreSQL база данных
│   ├── app-deployment.yaml      # Основное приложение
│   └── kustomization.yaml       # Базовая kustomization
└── overlays/
    └── local/                   # Локальное окружение
        ├── kustomization.yaml   # Локальная kustomization
        ├── app-patch.yaml       # Патчи для приложения
        └── postgres-patch.yaml  # Патчи для PostgreSQL
```

## Компоненты

### Основное приложение
- **Replicas**: 1 (для локального окружения)
- **Resources**: 256Mi RAM, 100m CPU
- **Port**: 5000 (внутри контейнера)
- **Health checks**: Включены

### PostgreSQL
- **Version**: 15-alpine
- **Storage**: 500Mi PVC (local-path)
- **Resources**: 128Mi RAM, 100m CPU
- **Persistence**: Включена

### Сеть
- **Service Type**: NodePort (порт 30080)
- **Internal Port**: 80 → 5000

## Управление

### Просмотр логов
```bash
# Логи приложения
kubectl logs -n diagram-generator -l app=diagram-generator-app -f

# Логи PostgreSQL
kubectl logs -n diagram-generator -l app=postgres -f
```

### Масштабирование
```bash
# Увеличить количество реплик приложения
kubectl scale deployment local-diagram-generator-app -n diagram-generator --replicas=2
```

### Обновление
```bash
# Пересборка и обновление образа
docker build -t diagram-generator:v1.1 .
kubectl set image deployment/local-diagram-generator-app -n diagram-generator app=diagram-generator:v1.1
```

### Подключение к базе данных
```bash
# Подключиться к PostgreSQL
kubectl exec -it -n diagram-generator deployment/local-postgres-deployment -- psql -U postgres -d diagram_generator
```

## Удаление

```bash
# Удалить все ресурсы
kubectl delete -k k8s/overlays/local

# Или удалить namespace (удалит все внутри)
kubectl delete namespace diagram-generator
```

## Отладка

### Проблемы с образом
- Убедитесь, что образ собран и доступен в кластере
- Для minikube: `eval $(minikube docker-env)` перед сборкой

### Проблемы с базой данных
- Проверьте PVC: `kubectl get pvc -n diagram-generator`
- Проверьте логи PostgreSQL на ошибки инициализации

### Проблемы с сетью
- Проверьте сервисы: `kubectl get svc -n diagram-generator`
- Для NodePort убедитесь, что порт 30080 доступен

## Конфигурация для продакшена

Для продакшена создайте новый overlay в `k8s/overlays/production` с:

- Ingress контроллером вместо NodePort
- Увеличенными ресурсами
- Внешней базой данных
- SSL сертификатами
- Мониторингом и логированием