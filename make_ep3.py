import os 
path = r'downloads\flow\ep3' 
os.makedirs(path, exist_ok=True) 
f = open(os.path.join(path, 'project_url.txt'), 'w', encoding='utf-8') 
f.write('https://labs.google/fx/ko/tools/flow/project/21fbaffb-1157-44f4-bd97-0d090dfb4293') 
f.close() 
print('¿Ï·á') 
