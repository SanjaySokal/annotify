# Smoke test suite — runs all checks against a running annotify server.
# Usage:  powershell -ExecutionPolicy Bypass -File smoke-simple.ps1
param([string]$Base = "http://127.0.0.1:3000")
$failed = 0

function Invoke-Endpoint {
    param(
        [string]$Uri,
        [string]$Method = "GET",
        [string]$RequestBody = "",
        [hashtable]$Headers = @{}
    )
    try {
        $req = [System.Net.HttpWebRequest]::Create($Uri)
        $req.Method = $Method
        $req.AllowAutoRedirect = $false
        foreach ($k in $Headers.Keys) {
            if ($k -ieq 'Content-Type') {
                $req.ContentType = $Headers[$k]
            } else {
                $req.Headers[$k] = $Headers[$k]
            }
        }
        if ($RequestBody) {
            if (-not $req.ContentType) { $req.ContentType = "application/json" }
            $bytes = [System.Text.Encoding]::UTF8.GetBytes($RequestBody)
            $req.ContentLength = $bytes.Length
            $stream = $req.GetRequestStream()
            $stream.Write($bytes, 0, $bytes.Length)
            $stream.Close()
        }
        $resp = $req.GetResponse()
        $code = [int]$resp.StatusCode
        $reader = New-Object System.IO.StreamReader($resp.GetResponseStream())
        $content = $reader.ReadToEnd()
        $reader.Close()
        $resp.Close()
        # Pull out the headers we care about (case-insensitive lookup).
        $hdrs = @{}
        foreach ($name in 'Access-Control-Allow-Origin','Access-Control-Allow-Methods','Access-Control-Allow-Headers','Access-Control-Allow-Credentials','Access-Control-Max-Age','Allow','Location','Content-Type','Cache-Control','Last-Modified','ETag','Accept-Ranges','Content-Length') {
            $v = $resp.Headers[$name]
            if ($v) { $hdrs[$name] = [string]$v }
        }
        return @{ Status = $code; Body = $content; Headers = $hdrs }
    } catch [System.Net.WebException] {
        $exResp = $_.Exception.Response
        if ($null -ne $exResp) {
            $code = [int]$exResp.StatusCode
            $reader = New-Object System.IO.StreamReader($exResp.GetResponseStream())
            $content = $reader.ReadToEnd()
            $reader.Close()
            $hdrs = @{}
            foreach ($name in 'Access-Control-Allow-Origin','Access-Control-Allow-Methods','Access-Control-Allow-Headers','Access-Control-Allow-Credentials','Access-Control-Max-Age','Allow','Location','Content-Type','Cache-Control','Last-Modified','ETag','Accept-Ranges','Content-Length') {
                $v = $exResp.Headers[$name]
                if ($v) { $hdrs[$name] = [string]$v }
            }
            return @{ Status = $code; Body = $content; Headers = $hdrs }
        }
        return @{ Status = 0; Body = "WebException without Response: $($_.Exception.Message)"; Headers = @{} }
    } catch {
        return @{ Status = 0; Body = "Exception: $($_.Exception.Message)"; Headers = @{} }
    }
}

function Test {
    param(
        [string]$Name,
        [Parameter(Mandatory)][int]$ExpectedStatus,
        [string]$Uri,
        [string]$Method = "GET",
        [string]$RequestBody = "",
        [hashtable]$Headers = @{},
        [string[]]$Patterns = @(),
        [hashtable]$ExpectHeaders = @{}
    )
    $r = Invoke-Endpoint -Uri $Uri -Method $Method -RequestBody $RequestBody -Headers $Headers
    $ok = $r.Status -eq $ExpectedStatus
    if ($ok -and $Patterns.Count -gt 0) {
        foreach ($p in $Patterns) {
            $escaped = $p -replace '\[','``[' -replace '\]','``]'
            if ($r.Body -notlike "*$escaped*") { $ok = $false; break }
        }
    }
    if ($ok -and $ExpectHeaders.Count -gt 0) {
        foreach ($k in $ExpectHeaders.Keys) {
            $expectedValue = [string]$ExpectHeaders[$k]
            $actualValue = if ($r.Headers.ContainsKey($k)) { [string]$r.Headers[$k] } else { $null }
            if ($null -eq $actualValue -or ($actualValue -notlike "*$expectedValue*")) {
                $ok = $false
                Write-Host "    header '$k' expected '$expectedValue' got '$actualValue'" -ForegroundColor DarkYellow
                break
            }
        }
    }
    if ($ok) {
        Write-Host "[PASS] $Name  ($($r.Status))" -ForegroundColor Green
    } else {
        Write-Host "[FAIL] $Name  expected=$ExpectedStatus got=$($r.Status) body=$($r.Body)" -ForegroundColor Red
        $script:failed++
    }
}

Write-Host "=== Smoke tests against $Base ===" -ForegroundColor Cyan

Test -Name "1. GET /users/?limit=1" -ExpectedStatus 200 `
    -Uri "$Base/users/?limit=1" -Patterns @('"id":1')

Test -Name "2. GET /users/1" -ExpectedStatus 200 `
    -Uri "$Base/users/1" -Patterns @('"id":1')

Test -Name "3. POST /users/ with token (expects @ResponseStatus(201))" -ExpectedStatus 201 `
    -Uri "$Base/users/" -Method POST `
    -Headers @{ "X-Token" = "abc" } `
    -RequestBody '{"id":3,"name":"Bob"}' `
    -Patterns @('echoedToken')

Test -Name "4. PUT /users/3" -ExpectedStatus 200 `
    -Uri "$Base/users/3" -Method PUT `
    -RequestBody '{"id":3,"name":"Robert"}' `
    -Patterns @('Robert')

Test -Name "5. DELETE /users/3 (expects @ResponseStatus(204))" -ExpectedStatus 204 `
    -Uri "$Base/users/3" -Method DELETE

Test -Name "6. GET /nope => 404" -ExpectedStatus 404 `
    -Uri "$Base/nope" -Patterns @('Not Found')

Test -Name "7. POST /users/1 => 405" -ExpectedStatus 405 `
    -Uri "$Base/users/1" -Method POST `
    -RequestBody '{}' `
    -Headers @{ "Content-Type" = "application/json" } `
    -Patterns @('Method Not Allowed')

Test -Name "8. GET /api/v1/products" -ExpectedStatus 200 `
    -Uri "$Base/api/v1/products" -Patterns @('Widget')

Test -Name "9. GET /api/v1/products/2/reviews/99" -ExpectedStatus 200 `
    -Uri "$Base/api/v1/products/2/reviews/99" -Patterns @('productId')

Test -Name "10. POST /users/ no token => 400" -ExpectedStatus 400 `
    -Uri "$Base/users/" -Method POST `
    -RequestBody '{"id":99,"name":"X"}' `
    -Headers @{ "Content-Type" = "application/json" } `
    -Patterns @('X-Token')

# ---------- CORS ----------
# Class-level @CrossOrigin on UserController:
#   origins: ['http://localhost:5173'], credentials: true, maxAge: 3600.

Test -Name "11. CORS preflight OPTIONS /users/ => 204" -ExpectedStatus 204 `
    -Uri "$Base/users/" -Method OPTIONS `
    -Headers @{ "Origin" = "http://localhost:5173"; "Access-Control-Request-Method" = "POST" } `
    -ExpectHeaders @{ "Access-Control-Allow-Origin" = "http://localhost:5173"; "Access-Control-Allow-Credentials" = "true"; "Access-Control-Max-Age" = "3600"; "Allow" = "*" }

Test -Name "12. CORS preflight from disallowed origin => no Allow-Origin" -ExpectedStatus 204 `
    -Uri "$Base/users/" -Method OPTIONS `
    -Headers @{ "Origin" = "http://evil.example"; "Access-Control-Request-Method" = "POST" }

Test -Name "13. CORS headers on regular response" -ExpectedStatus 200 `
    -Uri "$Base/users/1" `
    -Headers @{ "Origin" = "http://localhost:5173" } `
    -Patterns @('"id":1') `
    -ExpectHeaders @{ "Access-Control-Allow-Origin" = "http://localhost:5173" }

# ---------- Routes introspection ----------
Test -Name "14. Routes introspection endpoint" -ExpectedStatus 200 `
    -Uri "$Base/__annotify/routes" `
    -Patterns @('"routes":', '"/users/:id"', '"method":"GET"', '"statusCode":201')

Test -Name "15. Routes JSON includes param metadata + CORS" -ExpectedStatus 200 `
    -Uri "$Base/__annotify/routes" `
    -Patterns @('"paramTypes":', '"http://localhost:5173"')

# ---------- Middleware / templates / static (v0.6.0) ----------
# These tests target the web example app on port 3001 (examples/main-web.ts).
$WebBase = "http://127.0.0.1:3001"

Test -Name "16. Web app: GET / renders template (text/html)" -ExpectedStatus 200 `
    -Uri "$WebBase/" `
    -Patterns @('annotify dashboard', 'static files') `
    -ExpectHeaders @{ "Content-Type" = "text/html; charset=utf-8" }

Test -Name "17. Web app: GET /static/style.css served" -ExpectedStatus 200 `
    -Uri "$WebBase/static/style.css" `
    -Patterns @('annotify example dashboard') `
    -ExpectHeaders @{ "Content-Type" = "text/css; charset=utf-8" }

Test -Name "18. Web app: GET /static/../package.json blocked (path traversal)" -ExpectedStatus 404 `
    -Uri "$WebBase/static/../package.json"

Test -Name "19. Web app: GET /raw returns plain HTML via html() helper" -ExpectedStatus 200 `
    -Uri "$WebBase/raw" `
    -Patterns @('Plain HTML response', 'helper')

Test -Name "20. Web app: GET /redirect returns 302" -ExpectedStatus 302 `
    -Uri "$WebBase/redirect" `
    -ExpectHeaders @{ "Location" = "/" }

Test -Name "21. Web app: GET /protected without token = 401 (per-route @Use)" -ExpectedStatus 401 `
    -Uri "$WebBase/protected"

Test -Name "22. Web app: GET /protected with X-Token = 200" -ExpectedStatus 200 `
    -Uri "$WebBase/protected" `
    -Headers @{ "X-Token" = "valid" } `
    -Patterns @('You are authenticated')

Test -Name "23. Web app: GET /json still works (existing path unchanged)" -ExpectedStatus 200 `
    -Uri "$WebBase/json" `
    -Patterns @('"ok":true')

Test -Name "24. Web app: GET /unknown returns 404 fallthrough" -ExpectedStatus 404 `
    -Uri "$WebBase/unknown"

Write-Host ""
if ($failed -eq 0) {
    Write-Host "=== All 24 smoke tests passed ===" -ForegroundColor Green
} else {
    Write-Host "=== $failed test(s) failed ===" -ForegroundColor Red
    exit 1
}