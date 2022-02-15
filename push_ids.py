import requests
import time

zigzagUrl = "https://zigzag-markets.herokuapp.com/markets?id="


with open('zigzagIDs.txt', 'r') as openfileobject:
    for line in openfileobject:
        respons = requests.get(zigzagUrl + line.split(' ')[1])
        print(respons.json())
        time.sleep(0.25)
