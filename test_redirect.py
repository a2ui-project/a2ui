import asyncio
import httpx

async def main():
    async with httpx.AsyncClient() as client:
        try:
            async with client.stream("GET", "http://httpbin.org/redirect-to?url=http://127.0.0.1/", follow_redirects=True) as response:
                print("Final URL:", response.url)
        except Exception as e:
            print("Error:", e)

asyncio.run(main())
