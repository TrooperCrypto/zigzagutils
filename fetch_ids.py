import requests
import time


zigzagUrl = "https://zigzag-exchange.herokuapp.com/"
headers = {'content-type': 'application/json'}
postData =  {"op":"marketsreq","args":[1, True]}

response = requests.post(
    url=zigzagUrl,
    headers=headers,
    json=postData
)

responseParsed = response.json()
markets = responseParsed["args"][0]
savedMarkets = []

try:
    with open('zigzagIDs.txt', 'r') as openfileobject:
        for line in openfileobject:
            savedMarkets.append(line.split(' ')[0])
except:
    print("No old markets.")
print(savedMarkets)

f = open("zigzagIDs.txt", "a")

for market in markets:
    if market["alias"] not in savedMarkets:
        f.write(market["alias"] + " " + market["id"] + "\n")
