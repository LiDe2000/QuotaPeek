"""Isolated fake official API. Only synthetic accounts; no real credentials."""
import asyncio
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse
from pydantic import BaseModel, ConfigDict

ACCOUNTS = {'workbuddy': {'preview-wb-0', 'preview-wb-1', 'preview-wb-2'},
            'zcode': {'preview-zc-0', 'preview-zc-1'}}

class Claim(BaseModel):
    model_config = ConfigDict(extra='forbid')
    account_id: str

def create_app():
    api = FastAPI(title='QuotaPeek fake official activities', version='1.0.0')
    api.add_middleware(CORSMiddleware,
        allow_origins=['http://127.0.0.1:1420', 'http://localhost:1420'],
        allow_methods=['GET', 'POST'], allow_headers=['Content-Type', 'Accept'])
    states = {}
    counters = {'claims': 0, 'redirects': 0}

    @api.middleware('http')
    async def reject_credentials(request: Request, call_next):
        if any(key in request.headers for key in ('authorization', 'cookie', 'x-refresh-token')):
            return JSONResponse({'detail': 'Real authorization is never accepted by the mock.'}, status_code=400)
        return await call_next(request)

    def state(provider, account):
        if account not in ACCOUNTS.get(provider, set()):
            raise HTTPException(422, 'Only this provider\'s sample accounts are accepted')
        return states.get((provider, account), 'claimed' if account == 'preview-wb-1'
                          else 'verification' if account == 'preview-zc-1' else 'available')

    def reply(status):
        return {'code': 0, 'data': {'state': status}}

    @api.get('/health')
    def health():
        return {'status': 'ok', 'role': 'fake-official'}

    @api.post('/testing/reset')
    def reset():
        states.clear()
        counters.update(claims=0, redirects=0)
        return {'status': 'ok'}

    @api.get('/testing/stats')
    def stats():
        return counters.copy()

    @api.get('/testing/redirect-target')
    def redirect_target():
        counters['redirects'] += 1
        return reply('claimed')

    def broken_reply(fault):
        if fault == 'malformed':
            return Response('{', media_type='application/json')
        if fault == 'redirect':
            return RedirectResponse('/testing/redirect-target', status_code=302)
        return None

    @api.get('/mock/{provider}/status')
    def status(provider: str, account_id: str, response: Response, fault: str = ''):
        response.headers['Cache-Control'] = 'no-store'
        current = state(provider, account_id)
        return broken_reply(fault) or reply(current)

    @api.post('/mock/{provider}/claim')
    async def claim(provider: str, body: Claim, response: Response, fault: str = ''):
        current = state(provider, body.account_id)
        counters['claims'] += 1
        if current == 'available':
            current = 'pending' if body.account_id == 'preview-wb-2' else 'claimed'
            states[(provider, body.account_id)] = current
        response.headers['Cache-Control'] = 'no-store'
        # Commit first: the client cannot infer failure from a lost response.
        if fault == 'timeout':
            await asyncio.sleep(1)
        return broken_reply(fault) or reply(current)

    return api

app = create_app()
