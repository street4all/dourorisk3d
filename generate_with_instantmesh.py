import os
import shutil
import sys
import time
from gradio_client import Client, handle_file

def main():
    print("=== Gerador 3D IA: TencentARC InstantMesh ===", flush=True)
    image_path = os.path.abspath("public/images/santuario_sanfins.jpg")
    print(f"Fotografia de entrada: {image_path}", flush=True)
    
    start_time = time.time()
    try:
        client = Client("TencentARC/InstantMesh")
        print("Conectado à IA com sucesso!", flush=True)
        
        # Passo 1: Pré-processamento
        print("Passo 1/3: Pré-processamento e normalização...", flush=True)
        prep = client.predict(
            input_image=handle_file(image_path),
            do_remove_background=False,
            api_name="/preprocess"
        )
        print(f"Pré-processamento concluído: {prep}", flush=True)
        
        # Passo 2: Geração de multi-vistas neurais (Diffusion MVS)
        print("Passo 2/3: A gerar multi-vistas 360° com Difusão Neural (Diffusion MVS)...", flush=True)
        mvs = client.predict(
            input_image=handle_file(prep),
            sample_steps=75,
            sample_seed=42,
            api_name="/generate_mvs"
        )
        print(f"Multi-vistas geradas com sucesso: {mvs}", flush=True)
        
        # Passo 3: Reconstrução da malha 3D volumétrica e extração GLB
        print("Passo 3/3: Reconstrução da malha e extração do formato GLB PBR...", flush=True)
        models = client.predict(api_name="/make3d")
        print(f"Ficheiros 3D gerados: {models}", flush=True)
        
        # models is (output_model_obj_format, output_model_glb_format)
        glb_file = models[1] if isinstance(models, (list, tuple)) and len(models) > 1 else models
        print(f"GLB de saída: {glb_file}", flush=True)
        
        dest_glb = os.path.abspath("public/models/santuario_sanfins.glb")
        shutil.copyfile(glb_file, dest_glb)
        
        size_kb = os.path.getsize(dest_glb) / 1024
        elapsed = time.time() - start_time
        print(f"\n=======================================================", flush=True)
        print(f"SUCESSO TOTAL! Modelo IA GLB gravado em: {dest_glb}", flush=True)
        print(f"Tamanho do ficheiro: {size_kb:.1f} KB | Tempo total: {elapsed:.1f}s", flush=True)
        print(f"=======================================================", flush=True)
        
    except Exception as e:
        import traceback
        print(f"Erro no pipeline IA InstantMesh: {e}", file=sys.stderr, flush=True)
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    main()
