# 08 - I4-B publicación OKF mediante GitLab

## Objetivo

Comprobar que un corpus OKF válido genera un plan determinista, crea o reutiliza una propuesta GitLab y solo permite promover a `stable` cuando el Merge Request está aprobado y su CI está verde. Las pruebas normales son offline; GitLab real se activa únicamente con variables protegidas.

## Precondiciones

1. Node.js 22 y npm disponibles desde la raíz del repositorio.
2. Ejecutar `npm ci`, `npm run build` y `npm test`.
3. Usar `tests/fixtures/okf-valid` como corpus de prueba.
4. No copiar tokens, headers, JWT ni el cuerpo completo de documentos en la evidencia.

## Casos offline

### I4B-GITLAB-01 - plan seguro y determinista

```powershell
npm run okf:publication-plan -- tests/fixtures/okf-valid
npm run okf:publication-plan -- tests/fixtures/okf-valid
```

Esperado:

- ambos comandos terminan con código `0`;
- `branchName`, `corpusHash` y la lista de archivos son iguales;
- la salida contiene únicamente hash, rama, modo y rutas;
- no aparece contenido documental ni token.

### I4B-GITLAB-02 - validación previa y publicación deshabilitada por defecto

```powershell
npm run okf:validate -- tests/fixtures/okf-valid stable
npm run okf:publish -- tests/fixtures/okf-valid proposal
```

Esperado:

- `validate` termina con código `0`, `errors: 0` e `indexable: 1`;
- `publish` termina con código `2` si `KCP_GITLAB_PUBLICATION_ENABLED` no es `true`;
- no se realiza ninguna llamada de red ni se imprime un token.

### I4B-GITLAB-03 - fake offline y gates de promoción

```powershell
npm test -- tests/publication/fake-gitlab-adapter.test.ts tests/publication/publication-service.test.ts tests/ingestion/okf-publication-cli.test.ts
```

Esperado:

- la propuesta crea rama, commit y MR;
- repetir la propuesta reutiliza el mismo MR;
- corpus inválido, conflicto de rama y base modificada bloquean la operación;
- sin aprobación devuelve `APPROVAL_REQUIRED`;
- con aprobación pero CI no verde devuelve `CI_NOT_GREEN`;
- solo aprobación más CI `success` invoca el indexador estable.

## Caso con GitLab real autorizado

Ejecutar únicamente en un runner o sesión operativa autorizada, con el token inyectado por el gestor de secretos del CI. Nunca pasar el token como argumento.

```powershell
$env:KCP_GITLAB_PUBLICATION_ENABLED = "true"
$env:KCP_GITLAB_BASE_URL = "https://project.comsatel.com.pe"
$env:KCP_GITLAB_PROJECT_ID = "587"
$env:KCP_GITLAB_TOKEN = "MI PAT"
$env:KCP_GITLAB_BASE_BRANCH = "main"
$env:KCP_GITLAB_BRANCH_PREFIX = "knowledge/proposal"
npm run okf:publish -- tests/fixtures/okf-valid proposal
```

Esperado:

- se crea o reutiliza una rama cuyo nombre contiene el hash del corpus;
- se crea o reutiliza un MR abierto contra la rama base;
- repetir el comando no crea un MR duplicado;
- la salida no contiene el token ni el contenido completo;
- no se indexa `stable` durante `proposal`.

Después de aprobar el MR y confirmar CI verde, ejecutar el mismo flujo con `approved-publish` desde un entorno autorizado:

```powershell
npm run okf:publish -- tests/fixtures/okf-valid approved-publish
```

Esperado:

- sin aprobación o con CI distinto de `success`, la operación falla sin indexar;
- con ambos gates satisfechos, devuelve `stable-publish-authorized` y conserva hash, commit, MR y conteo;
- la evidencia no incluye credenciales ni contenido documental completo.

## Evidencia y limpieza

Guardar código de salida, commit probado, fecha/hora, versión Node/npm, hash del plan, branch y MR IID/URL. Sanitizar cualquier URL o salida antes de adjuntarla al ticket.

No ejecutar borrados masivos ni `docker compose down -v` como parte de esta prueba. Revocar o limpiar solo la variable temporal del token al terminar:

```powershell
Remove-Item Env:KCP_GITLAB_TOKEN -ErrorAction SilentlyContinue
```

## Criterio PASS/FAIL

| Criterio     | PASS                                        |
| ------------ | ------------------------------------------- |
| Plan         | Hash, branch y rutas reproducibles          |
| Idempotencia | La repetición no duplica MR                 |
| Gobernanza   | Corpus inválido y conflictos bloqueados     |
| Promoción    | Requiere aprobación y CI verde              |
| Seguridad    | No expone token, headers ni cuerpo completo |
| Offline      | Fake y pruebas pasan sin red                |
